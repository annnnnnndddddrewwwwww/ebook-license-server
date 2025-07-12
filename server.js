// server.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- Configuración de CORS ---
// Para producción, es MUY recomendable restringir 'origin' solo a la URL de tu ebook.
// Ejemplo:
// app.use(cors({ origin: 'https://tu-url-del-ebook.onrender.com' }));
// Para desarrollo y pruebas, permitimos cualquier origen:
app.use(cors());
app.use(express.json()); // Para parsear el body de las peticiones JSON

// --- Configuración de Persistencia de Licencias ---
const LICENSES_FILE = path.join(__dirname, 'licenses.json');
let licenses = new Map(); // Usaremos un Map para almacenar las licencias y sus datos

// Función para cargar las licencias desde el archivo
const loadLicenses = () => {
    if (fs.existsSync(LICENSES_FILE)) {
        try {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8');
            const parsedData = JSON.parse(data);
            // Convertir el objeto plano a un Map
            licenses = new Map(Object.entries(parsedData));
            console.log(`Licencias cargadas desde ${LICENSES_FILE}. Total: ${licenses.size}`);
        } catch (error) {
            console.error(`Error al cargar licencias desde ${LICENSES_FILE}:`, error);
            licenses = new Map(); // Si hay error, inicializar vacío
        }
    } else {
        console.log(`Archivo de licencias no encontrado: ${LICENSES_FILE}. Se creará uno nuevo.`);
        licenses = new Map();
    }
};

// Función para guardar las licencias en el archivo
const saveLicenses = () => {
    try {
        // Convertir el Map a un objeto plano para guardar en JSON
        const dataToSave = Object.fromEntries(licenses);
        fs.writeFileSync(LICENSES_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log(`Licencias guardadas en ${LICENSES_FILE}.`);
    } catch (error) {
        console.error(`Error al guardar licencias en ${LICENSES_FILE}:`, error);
    }
};

// Cargar las licencias al iniciar el servidor
loadLicenses();

// --- Middleware para obtener la IP del cliente ---
// Render usa 'x-forwarded-for' para pasar la IP real del cliente
app.set('trust proxy', true); // Necesario para que req.ip capture la IP real detrás del proxy de Render

// --- Endpoint para OBTENER TODAS las Licencias (para el generador) ---
app.get('/licenses', (req, res) => {
    // Convertir el Map a un array de objetos para enviarlo como JSON
    const licensesArray = Array.from(licenses.entries()).map(([key, value]) => ({
        key: key,
        ...value
    }));
    res.json(licensesArray);
});

// --- Endpoint para el Generador de Licencias ---
app.post('/generate-license', (req, res) => {
    const newLicenseKey = uuidv4(); // Genera un UUID v4 como licencia
    // Obtiene maxUsagesPerIp del body, o usa un valor por defecto (ej. 1 para uso único)
    const maxUsagesPerIp = req.body.maxUsagesPerIp ? parseInt(req.body.maxUsagesPerIp, 10) : 1;

    if (isNaN(maxUsagesPerIp) || maxUsagesPerIp < 1) {
        return res.status(400).json({ success: false, message: "maxUsagesPerIp debe ser un número entero positivo." });
    }

    // Almacena la licencia con su estado inicial
    licenses.set(newLicenseKey, {
        usedByIp: null,         // IP que ha usado la licencia por primera vez
        usageCount: 0,          // Contador de usos por la misma IP
        maxUsagesPerIp: maxUsagesPerIp, // Límite de usos para esta IP
        lastUsed: null,         // Marca de tiempo del último uso
        isValid: true           // Estado de validez de la licencia
    });
    saveLicenses(); // Guarda el estado actualizado

    console.log(`Licencia generada y añadida: ${newLicenseKey} (Max Usos por IP: ${maxUsagesPerIp})`);
    res.status(201).json({ success: true, license: newLicenseKey, message: "Licencia generada con éxito." });
});

// --- Endpoint para INVALIDAR una Licencia ---
app.post('/invalidate-license', (req, res) => {
    const { license: licenseKey } = req.body;

    if (!licenseKey) {
        return res.status(400).json({ success: false, message: "Clave de licencia no proporcionada para invalidar." });
    }

    const licenseData = licenses.get(licenseKey);

    if (!licenseData) {
        return res.status(404).json({ success: false, message: "Licencia no encontrada." });
    }

    if (!licenseData.isValid) {
        return res.status(200).json({ success: true, message: "La licencia ya está invalidada." });
    }

    licenseData.isValid = false; // Marca la licencia como inválida
    licenses.set(licenseKey, licenseData); // Actualiza el Map
    saveLicenses(); // Guarda el estado actualizado

    console.log(`Licencia '${licenseKey}' ha sido invalidada.`);
    res.json({ success: true, message: "Licencia invalidada con éxito." });
});

// --- Endpoint para la Validación de Licencias ---
app.post('/validate-license', (req, res) => {
    const { license: incomingLicenseKey } = req.body;
    const clientIp = req.ip; // Obtiene la IP del cliente

    if (!incomingLicenseKey) {
        console.log(`Intento de validación sin clave. IP: ${clientIp}`);
        return res.status(400).json({ valid: false, message: "Clave de licencia no proporcionada." });
    }

    const licenseData = licenses.get(incomingLicenseKey);

    if (!licenseData) {
        console.log(`Intento de validación con clave inexistente: '${incomingLicenseKey}'. IP: ${clientIp}`);
        return res.status(401).json({ valid: false, message: "Clave de licencia inválida o no activa." });
    }

    if (!licenseData.isValid) {
        console.log(`Intento de validación con clave invalidada: '${incomingLicenseKey}'. IP: ${clientIp}`);
        return res.status(403).json({ valid: false, message: "Esta licencia ha sido invalidada y ya no es válida." });
    }

    // Lógica para "solo se pueda utilizar N veces por IP"
    if (licenseData.usedByIp === null) {
        // Primera vez que se usa esta licencia
        licenseData.usedByIp = clientIp;
        licenseData.usageCount = 1;
        licenseData.lastUsed = new Date().toISOString();
        licenses.set(incomingLicenseKey, licenseData); // Actualiza el Map
        saveLicenses(); // Guarda el estado actualizado
        console.log(`Licencia '${incomingLicenseKey}' activada por primera vez por IP: ${clientIp}. Usos: 1/${licenseData.maxUsagesPerIp}`);
        return res.json({ valid: true, message: "Licencia válida y activada." });
    } else if (licenseData.usedByIp === clientIp) {
        // La licencia ya fue usada por esta misma IP
        if (licenseData.usageCount < licenseData.maxUsagesPerIp) {
            licenseData.usageCount++;
            licenseData.lastUsed = new Date().toISOString(); // Actualiza el timestamp
            licenses.set(incomingLicenseKey, licenseData); // Actualiza el Map
            saveLicenses(); // Guarda el estado actualizado
            console.log(`Licencia '${incomingLicenseKey}' re-validada por IP: ${clientIp}. Usos: ${licenseData.usageCount}/${licenseData.maxUsagesPerIp}`);
            return res.json({ valid: true, message: "Licencia válida." });
        } else {
            // La licencia ha alcanzado su límite de usos para esta IP
            console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de usos (${licenseData.maxUsagesPerIp}) por IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: `Esta licencia ha alcanzado su límite de ${licenseData.maxUsagesPerIp} usos para esta dirección IP.` });
        }
    } else {
        // La licencia ya fue usada por OTRA IP
        console.log(`Licencia '${incomingLicenseKey}' ya usada por IP: ${licenseData.usedByIp}. Intento de uso por IP: ${clientIp}`);
        return res.status(403).json({ valid: false, message: "Esta licencia ya ha sido utilizada por otra dirección IP." });
    }
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando. Usa /generate-license para generar, /validate-license para validar, y /licenses para ver todas.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor de licencias escuchando en el puerto ${port}`);
    console.log(`Las licencias se guardarán/cargarán en: ${LICENSES_FILE}`);
});