//var resources = require('./Resources.json');
var resources = require('./Resources.json');
var sensors = resources.smartBathtub.sensors;

// Variable global para controlar el tiempo de presencia
let contadorCiclos = 0;

exports.start = function () {
    console.log("==================================================");
    console.log("🚀 Simulador de bañera activado...");
    console.log("🌍 Conectado al clima de Puerto Real vía Node-RED");
    console.log("==================================================");
    
    setInterval(function () {
        
        // --- 1. SIMULACIÓN DE TEMPERATURA CONDICIONADA ---
        if (sensors.presencia.value == 1 && sensors.volume.value > 0) {
            sensors.temperature.value = (35 + Math.random() * 4).toFixed(1);
        } else {
            sensors.temperature.value = sensors.ambientTemperature ? sensors.ambientTemperature.value : 20.0; 
        }
        
        // --- 2. SIMULACIÓN DE NIVEL DE AGUA CON LÍMITE ---
        if (sensors.presencia.value == 1) { 
            if (sensors.volume.value < 100) {
                sensors.volume.value += 5; // Llenado progresivo
            } else {
                sensors.volume.value = 100; // Límite máximo
            }
        } else {
            sensors.volume.value = 0; // Vaciado instantáneo
        }

        // --- 3. SIMULAR JABÓN Y DISPARO ARCOÍRIS ---
        // Aseguramos que caidaJabon exista en el objeto sensors
        if (!sensors.caidaJabon) sensors.caidaJabon = { value: 0 };

        // REGLA: Solo cae si hay presencia (1) Y el agua está llena (100)
        if (sensors.presencia.value == 1 && sensors.volume.value == 100) {
            if (sensors.soap.value > 0) {
                sensors.soap.value -= 0.5;   // El jabón se gasta
                sensors.caidaJabon.value = 1; // ACTIVAMOS LA CAÍDA 
            } else {
                sensors.soap.value = 100;    // Recarga automática si se vacía
                sensors.caidaJabon.value = 0;
            }
        } else {
            // Si no hay alguien o el agua no está al 100%, la bola se detiene
            sensors.caidaJabon.value = 0;
        }

        // --- 4. SIMULACIÓN DE PRESENCIA ESTABLE ---
        contadorCiclos++;

        if (contadorCiclos >= 10) {
            sensors.presencia.value = Math.random() > 0.5 ? 1 : 0;
            contadorCiclos = 0;
            console.log(`🤖 Simulador: Presencia actualizada a: ${sensors.presencia.value}`);
        }

        // --- LOG DE MONITOREO ---
        const tAmbiente = sensors.ambientTemperature ? sensors.ambientTemperature.value : "N/A";
        // console.log(`🌡️ Agua: ${sensors.temperature.value}L | 👤 Pres: ${sensors.presencia.value} | 🧼 Jabón: ${sensors.soap.value}% | 🌈 Cayendo: ${sensors.caidaJabon.value}`);
        
    }, 2000); 
};