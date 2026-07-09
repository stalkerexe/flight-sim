import { Engine } from '@/core/Engine';
const container = document.getElementById('app');
if (!container) {
    throw new Error('#app container not found in index.html');
}
const engine = new Engine(container);
engine.start();
// Освобождаем GPU-ресурсы при закрытии/перезагрузке страницы.
window.addEventListener('beforeunload', () => engine.stop());
