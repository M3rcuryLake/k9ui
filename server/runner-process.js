const args = process.argv.slice(2);

console.log(`[runner] telemetry process started${args.length ? ` with ${args.join(' ')}` : ''}`);
console.log('[runner] bridge is broadcasting telemetry on ws://127.0.0.1:8080');

const keepAlive = setInterval(() => {
  process.stdout.write('[runner] listening\n');
}, 10000);

function shutdown(signal) {
  clearInterval(keepAlive);
  console.log(`[runner] received ${signal}; shutting down`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
