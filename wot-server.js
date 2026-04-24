// --- LIBRERÍAS ---
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mqtt = require('mqtt');
const { performance } = require('perf_hooks'); 

// --- IMPORTACIÓN DE TUS ARCHIVOS ---
const resources = require('./resources/Resources.json');
const simulator = require('./resources/sensorvalues');
const webSocketServer = require('./servers/websocket'); 

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==================================================
// 💾 CONFIGURACIÓN SQLITE & RENDIMIENTO
// ==================================================
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./bathtube_storage.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS historico_bañera (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        temp_agua REAL,
        temp_ambiente REAL,
        presencia INTEGER,
        volumen REAL,
        evento TEXT
    )`);
});

function persistirDatos(descripcionEvento) {
    const t0 = performance.now(); 
    const s = resources.smartBathtub.sensors;
    const query = `INSERT INTO historico_bañera (temp_agua, temp_ambiente, presencia, volumen, evento) 
                   VALUES (?, ?, ?, ?, ?)`;
    
    db.run(query, [s.temperature.value, s.ambientTemperature.value, s.presencia.value, s.volume.value, descripcionEvento], (err) => {
        const t1 = performance.now(); 
        if (err) console.error("❌ Error SQLite:", err.message);
        else console.log(`💾 [DB] Registro: ${descripcionEvento} | ⏱️ Rendimiento: ${(t1 - t0).toFixed(4)}ms`);
    });
}

// --- CONFIGURACIÓN MQTT ---
const client = mqtt.connect('mqtt://localhost');
const RETAINED_QOS1 = { qos: 1, retain: true };

let puertaYaGestionada = false; 

client.on('connect', () => {
    console.log("✅ Servidor WoT Conectado a Mosquitto");

    setInterval(() => {
        const bathSensors = resources.smartBathtub.sensors;
        const bathActuators = resources.smartBathtub.actuators;
        
        let presenciaActual = bathSensors.presencia.value; 
        let tempSimulada = bathSensors.temperature.value;
        
        // --- 1. LÓGICA DE VOLUMEN ---
        let volumenParaPublicar;
        if (presenciaActual == 0) {
            bathSensors.volume.value = 0; 
            volumenParaPublicar = 0;
            puertaYaGestionada = false; 
        } else {
            if (bathSensors.volume.value < 100) bathSensors.volume.value += 5; 
            volumenParaPublicar = bathSensors.volume.value;
        }

        // --- 2. LÓGICA AUTOMÁTICA (ENTRADA) ---
        if (presenciaActual == 1 && !puertaYaGestionada) {
            puertaYaGestionada = true; 
            bathActuators.door.value = true;
            bathActuators.light.value = true;
            client.publish('smartBathtub/sensors/door', 'ABIERTA', RETAINED_QOS1);
            client.publish('smartBathtub/sensors/light', 'ON', RETAINED_QOS1);

            setTimeout(() => {
                bathActuators.door.value = false;
                client.publish('smartBathtub/sensors/door', 'CERRADA', RETAINED_QOS1);
            }, 4000); 
        }

        // --- 3. LÓGICA DE APAGADO POR SEGURIDAD (VACÍO) ---
        if (presenciaActual == 0 && bathActuators.light.value === true) {
            bathActuators.light.value = false;
            client.publish('smartBathtub/sensors/light', 'OFF', RETAINED_QOS1);
            console.log("🌑 [SISTEMA] Luz apagada (Bañera vacía).");
        } 

        // --- 4. REFUERZO DE LUZ (PRESENCIA CONTINUA) ---
        if (presenciaActual == 1 && bathActuators.light.value === false) {
            bathActuators.light.value = true;
            client.publish('smartBathtub/sensors/light', 'ON', RETAINED_QOS1);
            console.log("💡 [LÓGICA] Re-encendiendo luz por presencia activa.");
        }

        // --- 5. PUBLICACIÓN MQTT & PERSISTENCIA ---
        client.publish('smartBathtub/sensors/presencia', presenciaActual.toString(), RETAINED_QOS1);
        client.publish('smartBathtub/sensors/volume', volumenParaPublicar.toString() + "L", RETAINED_QOS1);
        
        const tempAEnviar = (tempSimulada !== null) ? tempSimulada.toString() : "0";
        client.publish('smartBathtub/sensors/temperature', tempAEnviar, RETAINED_QOS1);

        // Publicación del estado de la caída del jabón (Animación)
        const caidaStatus = bathSensors.caidaJabon ? bathSensors.caidaJabon.value : 0;
        client.publish('smartBathtub/sensors/caidaJabon', caidaStatus.toString(), RETAINED_QOS1);

        // Publicación del nivel de jabón (Porcentaje %)
        const nivelSoap = bathSensors.soap ? bathSensors.soap.value : 100;
        client.publish('smartBathtub/sensors/soap', nivelSoap.toFixed(1), RETAINED_QOS1);

        persistirDatos(presenciaActual == 1 ? "Usuario Activo" : "Standby");

        // --- 6. LOG CONSOLA (COMPLETO: LUZ, AGUA, JABÓN) ---
        let luzEmoji = bathActuators.light.value ? "ON 💡" : "OFF ⚫";
        let jabonEmoji = caidaStatus === 1 ? "CAYENDO 🌈" : "QUIETO ⚪";
        
        console.log(`👤 Pres: ${presenciaActual} | 💧 Agua: ${volumenParaPublicar}L | 💡 Luz: ${luzEmoji} | 🧼 Jabón: ${nivelSoap.toFixed(0)}% (${jabonEmoji}) | 🌡️ Temp: ${tempAEnviar}°C`);
        
    }, 2000); 
});

// --- RUTA PARA RECIBIR COMANDOS ---
app.post('/smartBathtub/actuators', (req, res) => {
    const nuevoEstado = req.body;
    
    if (nuevoEstado.light !== undefined) {
        resources.smartBathtub.actuators.light.value = nuevoEstado.light;
        let valLuz = nuevoEstado.light ? 'ON' : 'OFF';
        client.publish('smartBathtub/sensors/light', valLuz, RETAINED_QOS1);
        console.log(`✉️ [REST] Actuador Luz -> ${valLuz}`);
    }
    
    if (nuevoEstado.door !== undefined) {
        resources.smartBathtub.actuators.door.value = nuevoEstado.door;
        let valPuer = nuevoEstado.door ? 'ABIERTA' : 'CERRADA';
        client.publish('smartBathtub/sensors/door', valPuer, RETAINED_QOS1);
        console.log(`✉️ [REST] Actuador Puerta -> ${valPuer}`);
    }

    res.status(200).json({ message: "Estado sincronizado", estado: resources.smartBathtub.actuators });
});

app.post('/smartBathtub/ambient', (req, res) => {
    const tempPuertoReal = req.body.temperature;
    if (tempPuertoReal !== undefined) {
        resources.smartBathtub.sensors.ambientTemperature.value = tempPuertoReal;
        res.status(200).send("Temperatura ambiente actualizada");
    } else {
        res.status(400).send("Error: Campo temperature faltante");
    }
});

app.get('/smartBathtub', (req, res) => {
    res.status(200).json(resources.smartBathtub);
});

// --- INICIO DEL SERVIDOR ---
simulator.start(); 
const port = resources.smartBathtub.port; 

const wotServer = app.listen(port, () => {
    console.log("==================================================");
    console.log(`🚀 Servidor WoT operativo en puerto ${port}`);
    console.log("==================================================");
});

webSocketServer.listen(wotServer);