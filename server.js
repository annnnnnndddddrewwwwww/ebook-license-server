// server.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// --- Configuración de CORS (¡CORREGIDO!) ---
// Configuración explícita de CORS para mayor robustez.
// En producción, es MUY recomendable restringir 'origin' solo a la URL de tu ebook.
// Ejemplo:
// const corsOptions = {
//     origin: 'https://tu-usuario.github.io', // O el dominio exacto donde está tu ebook
//     methods: ['GET', 'POST', 'PUT', 'DELETE'], // Métodos que tu API usará
//     allowedHeaders: ['Content-Type', 'Authorization'], // Cabeceras permitidas
//     credentials: true // Si necesitas manejar cookies o credenciales
// };
// app.use(cors(corsOptions));
// Para desarrollo y pruebas, permitimos cualquier origen y métodos comunes:
app.use(cors({
    origin: '*', // Permite cualquier origen. CAMBIA ESTO PARA PRODUCCIÓN.
    methods: ['GET', 'POST'], // Tu frontend solo usa POST para validar
    allowedHeaders: ['Content-Type'] // Solo necesitas Content-Type para JSON
}));

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
    // Obtiene maxUniqueIps del body, o usa un valor por defecto (ej. 1 para uso único por IP)
    const maxUniqueIps = req.body.maxUniqueIps ? parseInt(req.body.maxUniqueIps, 10) : 1;

    if (isNaN(maxUniqueIps) || maxUniqueIps < 1) {
        return res.status(400).json({ success: false, message: "El límite de IPs únicas debe ser un número entero positivo." });
    }

    // Almacena la licencia con su estado inicial
    licenses.set(newLicenseKey, {
        activatedIps: [],     // Array de IPs únicas que han usado la licencia
        maxUniqueIps: maxUniqueIps, // Límite de IPs únicas permitidas
        lastUsed: null,       // Marca de tiempo del último uso (cualquier IP)
        isValid: true         // Estado de validez de la licencia
    });
    saveLicenses(); // Guarda el estado actualizado

    console.log(`Licencia generada y añadida: ${newLicenseKey} (Máx IPs únicas: ${maxUniqueIps})`);
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

// --- Endpoint para la Validación de Licencias (¡NOMBRE CORREGIDO!) ---
app.post('/validate-and-register-license', (req, res) => { // <-- ¡CAMBIADO AQUÍ!
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

    // Lógica para "N IPs diferentes pueden usar esta licencia, pero una vez activada por una IP,
    // esa IP puede usarla indefinidamente."
    const isIpAlreadyActivated = licenseData.activatedIps.includes(clientIp);

    if (isIpAlreadyActivated) {
        // La IP ya está en la lista de IPs activadas.
        // Se permite el acceso sin restricciones adicionales para esta IP.
        licenseData.lastUsed = new Date().toISOString(); // Actualiza el timestamp del último uso
        licenses.set(incomingLicenseKey, licenseData); // Actualiza el Map
        saveLicenses(); // Guarda el estado actualizado
        console.log(`Licencia '${incomingLicenseKey}' re-validada por IP: ${clientIp}. IPs únicas usadas: ${licenseData.activatedIps.length}/${licenseData.maxUniqueIps}`);
        return res.json({ valid: true, message: "Licencia válida." });
    } else {
        // Es una IP nueva intentando usar esta licencia
        if (licenseData.activatedIps.length < licenseData.maxUniqueIps) {
            // Aún hay slots para IPs únicas. Añadir la nueva IP.
            licenseData.activatedIps.push(clientIp);
            licenseData.lastUsed = new Date().toISOString(); // Actualiza el timestamp
            licenses.set(incomingLicenseKey, licenseData); // Actualiza el Map
            saveLicenses(); // Guarda el estado actualizado
            console.log(`Licencia '${incomingLicenseKey}' activada por nueva IP: ${clientIp}. IPs únicas usadas: ${licenseData.activatedIps.length}/${licenseData.maxUniqueIps}`);
            return res.json({ valid: true, message: "Licencia válida y activada para esta IP." });
        } else {
            // Se ha alcanzado el límite de IPs únicas para esta licencia.
            // La nueva IP no puede usarla.
            console.log(`Licencia '${incomingLicenseKey}' ha alcanzado su límite de ${licenseData.maxUniqueIps} IPs únicas. Intento de uso por IP: ${clientIp}`);
            return res.status(403).json({ valid: false, message: `Esta licencia ya ha sido activada por su número máximo de ${licenseData.maxUniqueIps} IPs diferentes.` });
        }
    }
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando. Usa /generate-license para generar, /validate-and-register-license para validar, y /licenses para ver todas.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor de licencias escuchando en el puerto ${port}`);
    console.log(`Las licencias se guardarán/cargarán en: ${LICENSES_FILE}`);
});