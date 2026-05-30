const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const certsDir = path.join(__dirname, '..', 'certs');

console.log('🛡️ Generador de Certificados SSL Auto-firmados para VeciTurno');
console.log('------------------------------------------------------------');

async function run() {
  try {
    if (!fs.existsSync(certsDir)) {
      console.log(`📁 Creando directorio para certificados en: ${certsDir}`);
      fs.mkdirSync(certsDir, { recursive: true });
    }

    const attrs = [
      { name: 'commonName', value: 'localhost' }
    ];

    console.log('🔑 Generando clave privada y certificado x509 auto-firmado...');
    const pems = await selfsigned.generate(attrs, {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'basicConstraints',
          cA: true
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: '127.0.0.1' }
          ]
        }
      ]
    });

    const keyPath = path.join(certsDir, 'key.pem');
    const certPath = path.join(certsDir, 'cert.pem');

    fs.writeFileSync(keyPath, pems.private, 'utf8');
    fs.writeFileSync(certPath, pems.cert, 'utf8');

    console.log('✅ Certificados SSL auto-firmados generados con éxito!');
    console.log(`🔑 Clave Privada: ${keyPath}`);
    console.log(`📜 Certificado: ${certPath}`);
    console.log('------------------------------------------------------------');
    console.log('💡 NOTA: Tu navegador advertirá que el certificado es auto-firmado.');
    console.log('   Esto es NORMAL en local. Haz clic en "Avanzado" -> "Acceder" para entrar.');
  } catch (error) {
    console.error('❌ Error generando los certificados:', error);
    process.exit(1);
  }
}

run();
