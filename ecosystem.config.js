module.exports = {
  apps: [
    {
      name: 'veciturno',
      script: 'server.js',
      // NOTA: Para whatsapp-web.js/Puppeteer, debemos usar el modo "fork" (1 sola instancia).
      // El modo "cluster" causaría conflictos de recursos con múltiples sesiones del navegador Chromium.
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '800M', // Mantener consumo bajo en la capa gratuita de Oracle Cloud
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      restart_delay: 5000 // Esperar 5 segundos antes de reiniciar para evitar bucles infinitos en caso de caídas
    }
  ]
};
