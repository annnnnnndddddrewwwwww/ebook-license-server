require('dotenv').config();
const express = require('express');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library'); // Correct import for JWT
const cors = require('cors');
const { v4: uuidv4 } = require('uuid'); // For generating license keys
const nodemailer = require('nodemailer'); // For sending emails

const app = express();
const port = process.env.PORT || 10000;

// --- Middlewares ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Enable JSON body parsing

// --- Google Sheets Configuration ---
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
// IMPORTANT: Replace '\\n' with '\n' for multi-line private key in Render
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Ensure all Google Sheet environment variables are set
if (!SPREADSHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.error('ERROR: Missing Google Sheet environment variables. Please check .env file or Render settings.');
    process.exit(1);
}

// Initialize auth
const serviceAccountAuth = new JWT({
    email: SERVICE_ACCOUNT_EMAIL,
    key: PRIVATE_KEY,
    scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
    ],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

let licensesSheet = null;
let appConfigSheet = null; // New sheet for application configuration (e.g., maintenance mode)

// --- Email Transporter Configuration (for sending emails from server, if needed) ---
// Note: This is separate from the generator.py's email sending.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // Use 'true' or 'false' in .env
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Test email transporter connection
transporter.verify(function (error) {
    if (error) {
        console.error('Error connecting to SMTP server:', error);
    } else {
        console.log('SMTP server is ready to take our messages');
    }
});


// --- Sheet Initialization ---
async function initializeGoogleSheets() {
    try {
        await doc.loadInfo(); // Loads document properties and worksheets
        console.log('Autenticación con Google Sheets exitosa!');

        // --- Licenses Sheet ---
        licensesSheet = doc.sheetsByTitle['Licenses']; // Assuming your sheet is named 'Licenses'
        if (!licensesSheet) {
            console.warn("Sheet 'Licenses' not found. Attempting to create it.");
            licensesSheet = await doc.addSheet({
                title: 'Licenses',
                headerValues: ['licenseKey', 'MaxIPs', 'usedIPs', 'isUsed', 'ExpiryDate', 'createdAt', 'lastUsedIP', 'lastUsedAt']
            });
            console.log("Sheet 'Licenses' created with required headers.");
        } else {
            // Ensure headers are correct for existing sheet
            const currentHeaders = await licensesSheet.getRows({ limit: 1, offset: 0 }).then(rows => rows.length > 0 ? Object.keys(rows[0]) : []);
            const requiredHeaders = ['licenseKey', 'MaxIPs', 'usedIPs', 'isUsed', 'ExpiryDate', 'createdAt', 'lastUsedIP', 'lastUsedAt'];
            const missingHeaders = requiredHeaders.filter(header => !currentHeaders.includes(header));

            if (missingHeaders.length > 0) {
                console.warn(`Missing headers in 'Licenses' sheet: ${missingHeaders.join(', ')}. Please update sheet manually or regenerate.`);
                // Note: Adding headers programmatically can be complex if data already exists.
                // It's safer to warn and let user handle, or use doc.updateProperties to set headers if sheet is empty.
            }
        }


        // --- AppConfig Sheet ---
        appConfigSheet = doc.sheetsByTitle['AppConfig']; // Sheet for global app configurations
        if (!appConfigSheet) {
            console.warn("Sheet 'AppConfig' not found. Attempting to create it.");
            appConfigSheet = await doc.addSheet({
                title: 'AppConfig',
                headerValues: ['SettingName', 'SettingValue']
            });
            console.log("Sheet 'AppConfig' created.");
        }

        // Initialize maintenance mode in AppConfig sheet
        await updateMaintenanceModeInSheet(false, false); // Initialize to false if not found
        console.log("Modo de mantenimiento inicializado.");

    } catch (error) {
        console.error('Error al inicializar Google Sheets:', error);
        // Decide whether to exit the process or try to recover
        process.exit(1); // Exit if critical sheets cannot be initialized
    }
}

// --- Helper for Maintenance Mode in Sheet ---
async function updateMaintenanceModeInSheet(mode, updateExisting = true) {
    if (!appConfigSheet) {
        console.error("AppConfig sheet not initialized.");
        return false;
    }
    const settingName = 'maintenanceMode';
    try {
        const rows = await appConfigSheet.getRows();
        let maintenanceRow = rows.find(row => row.SettingName === settingName);

        if (maintenanceRow) {
            if (updateExisting) {
                maintenanceRow.SettingValue = String(mode);
                await maintenanceRow.save();
                console.log(`Configuración 'maintenanceMode' actualizada en Google Sheets: ${mode}`);
            } else {
                console.log(`Fila con SettingName='${settingName}' ya existe con valor '${maintenanceRow.SettingValue}'. No se actualiza si updateExisting es false.`);
            }
        } else {
            await appConfigSheet.addRow({ SettingName: settingName, SettingValue: String(mode) });
            console.log(`No se encontró la fila con SettingName='${settingName}' para actualizar en AppConfig. Se añadió con valor: ${mode}`);
        }
        return true;
    } catch (error) {
        console.error(`Error al gestionar 'maintenanceMode' en Google Sheets:`, error);
        return false;
    }
}

async function getMaintenanceModeFromSheet() {
    if (!appConfigSheet) {
        console.error("AppConfig sheet not initialized.");
        return false; // Default to false if sheet not ready
    }
    try {
        const rows = await appConfigSheet.getRows();
        const maintenanceRow = rows.find(row => row.SettingName === 'maintenanceMode');
        return maintenanceRow ? maintenanceRow.SettingValue === 'true' : false;
    } catch (error) {
        console.error('Error al obtener el modo de mantenimiento de Google Sheets:', error);
        return false; // Default to false on error
    }
}

// --- API Endpoints ---

// Middleware for maintenance mode check
app.use(async (req, res, next) => {
    // Allow maintenance mode routes to bypass the check
    if (req.path.startsWith('/get-maintenance-status') || req.path.startsWith('/set-maintenance-mode')) {
        return next();
    }

    const inMaintenance = await getMaintenanceModeFromSheet();
    if (inMaintenance) {
        return res.status(503).json({ success: false, message: 'El servidor está en modo de mantenimiento. Por favor, inténtalo más tarde.' });
    }
    next();
});

// Generates a new license key and saves it to Google Sheets
app.post('/generate-license', async (req, res) => {
    try {
        const { maxIPs } = req.body; // maxIPs sent from generator.py
        const newLicenseKey = uuidv4();
        const createdAt = new Date().toISOString();

        // Calculate ExpiryDate (e.g., 1 year from now)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        // Ensure maxIPs is a valid number, default to 1 if not
        let actualMaxIPs = parseInt(maxIPs);
        if (isNaN(actualMaxIPs) || actualMaxIPs < 1) {
            actualMaxIPs = 1; // Default to 1 IP if invalid or not provided
            console.warn(`Invalid or missing maxIPs for new license. Defaulting to ${actualMaxIPs}.`);
        }

        const newRow = {
            licenseKey: newLicenseKey,
            MaxIPs: actualMaxIPs, // Storing the actual numeric value here
            usedIPs: '', // Initialize as empty string for comma-separated IPs
            isUsed: 'FALSE',
            ExpiryDate: expiryDate.toISOString().split('T')[0], // YYYY-MM-DD
            createdAt: createdAt,
            lastUsedIP: '', // New column for last used IP
            lastUsedAt: '' // New column for last used timestamp
        };

        await licensesSheet.addRow(newRow);
        console.log(`Licencia generada: ${newLicenseKey} con ${actualMaxIPs} IPs máximas.`);
        res.json({ success: true, message: 'Licencia generada y registrada con éxito.', licenseKey: newLicenseKey });

    } catch (error) {
        console.error('Error al generar la licencia:', error);
        res.status(500).json({ success: false, message: 'Fallo interno al generar la licencia.' });
    }
});

// Validates a license key and registers the IP
app.post('/validate-and-register-license', async (req, res) => {
    const { licenseKey, username, email } = req.body;
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!licenseKey || !username || !email) {
        return res.status(400).json({ success: false, message: 'Faltan parámetros (licenseKey, username, email).' });
    }

    try {
        const rows = await licensesSheet.getRows();
        const licenseRow = rows.find(row => row.licenseKey === licenseKey);

        if (!licenseRow) {
            return res.status(404).json({ success: false, message: 'Licencia no encontrada.' });
        }

        // --- License Expiration Check ---
        const expiryDate = new Date(licenseRow.ExpiryDate);
        if (isNaN(expiryDate.getTime()) || expiryDate < new Date()) {
            return res.status(403).json({ success: false, message: 'La licencia ha caducado.' });
        }

        // --- Get MaxIPs for this license ---
        let maxIPs = parseInt(licenseRow.MaxIPs);
        if (isNaN(maxIPs) || maxIPs < 1) {
            // Fallback if MaxIPs in sheet is invalid, use default from env or fixed.
            maxIPs = parseInt(process.env.MAX_IPS_PER_LICENSE || '1'); // Use ENV var if sheet is bad
            if (isNaN(maxIPs) || maxIPs < 1) {
                 maxIPs = 1; // Final fallback
            }
            console.warn(`MaxIPs for license ${licenseKey} in sheet is invalid. Using fallback: ${maxIPs}`);
        }

        // --- Get current used IPs ---
        let usedIPs = licenseRow.usedIPs ? licenseRow.usedIPs.split(',').map(ip => ip.trim()).filter(ip => ip !== '') : [];

        // Check if current IP is already registered
        if (usedIPs.includes(clientIp)) {
            // Update last used time if already registered
            licenseRow.lastUsedIP = clientIp;
            licenseRow.lastUsedAt = new Date().toISOString();
            await licenseRow.save();
            return res.json({ success: true, message: 'Licencia ya activa para esta IP.' });
        }

        // Check if max IP limit reached
        if (usedIPs.length >= maxIPs) {
            console.warn(`Licencia '${licenseKey}' ha alcanzado su límite de ${maxIPs} IPs únicas. Intento de uso por IP: ${clientIp}`);
            return res.status(403).json({ success: false, message: `Esta licencia ya ha sido activada por su número máximo de ${maxIPs} IPs diferentes.` });
        }

        // Register new IP
        usedIPs.push(clientIp);
        licenseRow.usedIPs = usedIPs.join(',');
        licenseRow.isUsed = 'TRUE'; // Mark as used
        licenseRow.lastUsedIP = clientIp;
        licenseRow.lastUsedAt = new Date().toISOString();
        await licenseRow.save();

        console.log(`Licencia '${licenseKey}' activada por nueva IP: ${clientIp}. Total IPs: ${usedIPs.length}/${maxIPs}`);
        res.json({ success: true, message: 'Licencia activada con éxito.' });

    } catch (error) {
        console.error('Error al validar y registrar licencia:', error);
        res.status(500).json({ success: false, message: 'Fallo interno al validar la licencia.' });
    }
});

// Gets all licenses (for the generator/admin panel)
app.get('/licenses', async (req, res) => {
    try {
        const rows = await licensesSheet.getRows();
        const licenses = rows.map(row => {
            let maxIPs = parseInt(row.MaxIPs);
            if (isNaN(maxIPs)) {
                maxIPs = 1; // Default if MaxIPs is invalid in sheet
            }
            const usedIPs = row.usedIPs ? row.usedIPs.split(',').map(ip => ip.trim()).filter(ip => ip !== '') : [];

            return {
                licenseKey: row.licenseKey,
                maxIPs: maxIPs,
                usedIPs: usedIPs,
                isUsed: row.isUsed === 'TRUE', // Convert to boolean
                expiresAt: row.ExpiryDate,
                createdAt: row.createdAt,
                lastUsedIP: row.lastUsedIP,
                lastUsedAt: row.lastUsedAt
            };
        });
        res.json({ success: true, licenses: licenses });
    } catch (error) {
        console.error('Error al obtener licencias:', error);
        res.status(500).json({ success: false, message: 'Fallo interno al obtener licencias.' });
    }
});

// --- Maintenance Mode Endpoints ---
app.get('/get-maintenance-status', async (req, res) => {
    try {
        const maintenanceMode = await getMaintenanceModeFromSheet();
        res.json({ success: true, maintenanceMode: maintenanceMode });
    } catch (error) {
        console.error('Error al obtener estado de mantenimiento:', error);
        res.status(500).json({ success: false, message: 'Fallo interno al obtener estado de mantenimiento.' });
    }
});

app.post('/set-maintenance-mode', async (req, res) => {
    const { maintenanceMode } = req.body; // Expects a boolean true/false
    if (typeof maintenanceMode === 'undefined') {
        return res.status(400).json({ success: false, message: 'Parámetro maintenanceMode requerido.' });
    }

    try {
        const success = await updateMaintenanceModeInSheet(maintenanceMode);
        if (success) {
            res.json({ success: true, message: `Modo de mantenimiento cambiado a ${maintenanceMode}` });
        } else {
            res.status(500).json({ success: false, message: 'Fallo al cambiar el modo de mantenimiento.' });
        }
    } catch (error) {
        console.error('Error al establecer modo de mantenimiento:', error);
        res.status(500).json({ success: false, message: 'Fallo interno al establecer modo de mantenimiento.' });
    }
});


// --- Start Server ---
async function startServer() {
    await initializeGoogleSheets();
    app.listen(port, () => {
        console.log(`Servidor de licencias escuchando en el puerto ${port}`);
        console.log(`ID de Google Sheet: ${SPREADSHEET_ID}`);
    });
}

startServer();