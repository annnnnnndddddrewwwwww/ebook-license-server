// server.js
const express = require('express');
const { v4: uuidv4 } = require('uuid'); // Para generar IDs únicos
const cors = require('cors'); // Para permitir peticiones desde el frontend

const app = express();
const port = process.env.PORT || 3000;

// Configuración de CORS: permite que el frontend (tu ebook) acceda a este backend.
// En producción, es MUY recomendable restringir `origin` solo a la URL de tu ebook.
// Por ejemplo: cors({ origin: 'https://tu-ebook.onrender.com' })
app.use(cors());
app.use(express.json()); // Para parsear el body de las peticiones JSON

// *** ALMACENAMIENTO DE LICENCIAS (PARA PRODUCCIÓN, USA UNA BASE DE DATOS REAL) ***
// Por simplicidad, aquí usaremos un Set en memoria.
// Esto significa que las licencias se perderán cada vez que el servidor se reinicie.
// Para producción, DEBES usar una base de datos persistente (MongoDB, PostgreSQL, etc.).
const validLicenses = new Set();
// ********************************************************************************

// --- Endpoint para el Generador de Licencias (usado por ti para crear licencias) ---
app.post('/generate-license', (req, res) => {
    // Puedes añadir lógica para que solo usuarios autorizados puedan generar licencias
    // Por ejemplo, mediante un token de autenticación o una clave secreta en el header.

    const newLicense = uuidv4(); // Genera un UUID v4 como licencia
    validLicenses.add(newLicense); // Almacena la licencia (en memoria)
    console.log(`Licencia generada y añadida: ${newLicense}`);
    res.status(201).json({ success: true, license: newLicense, message: "Licencia generada con éxito." });
});

// --- Endpoint para la Validación de Licencias (usado por el Ebook) ---
app.post('/validate-license', (req, res) => {
    const { license } = req.body;

    if (!license) {
        return res.status(400).json({ valid: false, message: "Clave de licencia no proporcionada." });
    }

    if (validLicenses.has(license)) {
        console.log(`Licencia '${license}' validada correctamente.`);
        res.json({ valid: true, message: "Licencia válida." });
    } else {
        console.log(`Intento de validación con licencia inválida: '${license}'`);
        res.status(401).json({ valid: false, message: "Clave de licencia inválida o no activa." });
    }
});

// Ruta de bienvenida (opcional, para verificar que el servidor está corriendo)
app.get('/', (req, res) => {
    res.send('Servidor de licencias de Ebook funcionando. Usa /generate-license para generar y /validate-license para validar.');
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`Servidor de licencias escuchando en el puerto ${port}`);
    console.log('¡Advertencia! Las licencias se almacenan en memoria y se perderán al reiniciar el servidor.');
    console.log('Considera implementar una base de datos persistente para producción.');
});