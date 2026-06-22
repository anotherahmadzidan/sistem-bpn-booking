(function () {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 10000;
    const OVERLAY_DELAY_MS = 0;
    const activeOperations = new Map();
    const renderGenerations = new WeakMap();
    const lockedScopes = new WeakMap();
    const buttonScopes = new WeakMap();
    let operationSequence = 0;

    class AppRequestError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'AppRequestError';
            this.code = options.code || 'REQUEST_FAILED';
            this.status = options.status || 0;
            this.payload = options.payload;
            this.cause = options.cause;
        }
    }

    function ensureLoadingUi() {
        let overlay = document.getElementById('app-async-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'app-async-overlay';
            overlay.className = 'app-async-overlay';
            overlay.hidden = true;
            overlay.setAttribute('aria-hidden', 'true');
            document.body.appendChild(overlay);
        }

        let progress = document.getElementById('app-async-progress');
        if (!progress) {
            progress = document.createElement('div');
            progress.id = 'app-async-progress';
            progress.className = 'app-async-progress';
            progress.hidden = true;
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', 'Proses sedang berjalan');
            progress.innerHTML = '<span class="app-async-progress__bar"></span>';
            document.body.appendChild(progress);
        }

        return { overlay, progress };
    }

    function refreshLoadingUi() {
        const { overlay, progress } = ensureLoadingUi();
        const visibleOperations = Array.from(activeOperations.values()).filter(item => item.visible);
        if (visibleOperations.length === 0) {
            overlay.hidden = true;
            progress.hidden = true;
            document.body.classList.remove('app-operation-active');
            return;
        }

        overlay.hidden = false;
        progress.hidden = false;
        document.body.classList.add('app-operation-active');
    }

    function startOperation(label = 'Memproses...', options = {}) {
        const id = ++operationSequence;
        const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : OVERLAY_DELAY_MS;
        const operation = {
            id,
            label,
            visible: false,
            timer: null
        };
        activeOperations.set(id, operation);

        if (delayMs <= 0) {
            operation.visible = true;
            refreshLoadingUi();
        } else {
            operation.timer = window.setTimeout(() => {
                operation.visible = true;
                refreshLoadingUi();
            }, delayMs);
        }
        return id;
    }

    function finishOperation(id) {
        const operation = activeOperations.get(id);
        if (!operation) return;
        window.clearTimeout(operation.timer);
        activeOperations.delete(id);
        refreshLoadingUi();
    }

    function resolveScope(button, options = {}) {
        const requestedScope = options.scope || options.form;
        if (requestedScope instanceof Element) return requestedScope;
        if (typeof requestedScope === 'string') {
            const selected = document.querySelector(requestedScope);
            if (selected) return selected;
        }
        if (!button) return null;
        return button.form
            || button.closest('[data-app-form], form, .target-card, .modal, .card');
    }

    function lockScope(scope) {
        if (!scope) return;
        const existing = lockedScopes.get(scope);
        if (existing) {
            existing.count += 1;
            return;
        }

        const controls = Array.from(scope.querySelectorAll(
            'input, select, textarea, button, fieldset'
        ));
        const disabledStates = new Map(
            controls.map(control => [control, control.disabled])
        );

        controls.forEach(control => {
            control.disabled = true;
        });
        scope.setAttribute('aria-busy', 'true');
        scope.classList.add('app-form-loading');
        lockedScopes.set(scope, { count: 1, disabledStates });
    }

    function unlockScope(scope) {
        if (!scope) return;
        const state = lockedScopes.get(scope);
        if (!state) return;

        state.count -= 1;
        if (state.count > 0) return;

        state.disabledStates.forEach((wasDisabled, control) => {
            if (control.isConnected) control.disabled = wasDisabled;
        });
        scope.removeAttribute('aria-busy');
        scope.classList.remove('app-form-loading');
        lockedScopes.delete(scope);
    }

    function setButtonLoading(button, isLoading, label = 'Memproses...', options = {}) {
        if (!button) return true;

        if (isLoading) {
            if (button.dataset.appBusy === 'true') return false;
            button.dataset.appBusy = 'true';
            button.dataset.appOriginalHtml = button.innerHTML;
            button.dataset.appOriginalDisabled = String(button.disabled);
            const scope = options.lockForm === false ? null : resolveScope(button, options);
            if (scope) {
                buttonScopes.set(button, scope);
                lockScope(scope);
            }
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.classList.add('app-button-loading');
            button.innerHTML = `<span class="app-button-spinner" aria-hidden="true"></span><span>${label}</span>`;
            if (options.overlay !== false) {
                button.dataset.appOperationId = String(startOperation(options.overlayLabel || label, options));
            }
            return true;
        }

        const wasBusy = button.dataset.appBusy === 'true';
        const operationId = Number(button.dataset.appOperationId);
        if (operationId) finishOperation(operationId);
        const scope = buttonScopes.get(button);
        if (scope) {
            unlockScope(scope);
            buttonScopes.delete(button);
        }
        if (button.dataset.appOriginalHtml !== undefined) {
            button.innerHTML = button.dataset.appOriginalHtml;
        }
        delete button.dataset.appBusy;
        delete button.dataset.appOriginalHtml;
        const originalDisabled = button.dataset.appOriginalDisabled === 'true';
        delete button.dataset.appOriginalDisabled;
        delete button.dataset.appOperationId;
        if (wasBusy) {
            button.disabled = options.keepDisabled === undefined
                ? originalDisabled
                : Boolean(options.keepDisabled);
        }
        button.removeAttribute('aria-busy');
        button.classList.remove('app-button-loading');
        return true;
    }

    function isBusy() {
        return activeOperations.size > 0;
    }

    function blockInteractionWhileBusy(event) {
        if (!isBusy()) return;
        if (
            event.type === 'keydown'
            && !['Tab', 'Enter', ' ', 'Escape'].includes(event.key)
        ) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    ['click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'wheel'].forEach(eventName => {
        document.addEventListener(eventName, blockInteractionWhileBusy, {
            capture: true,
            passive: false
        });
    });
    document.addEventListener('keydown', blockInteractionWhileBusy, true);

    function createCombinedSignal(controller, externalSignal) {
        if (!externalSignal) return () => {};
        if (externalSignal.aborted) {
            controller.abort(externalSignal.reason);
            return () => {};
        }

        const abort = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener('abort', abort, { once: true });
        return () => externalSignal.removeEventListener('abort', abort);
    }

    async function parseErrorPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        try {
            if (contentType.includes('application/json')) return await response.json();
            const text = await response.text();
            return text ? { message: text } : {};
        } catch {
            return {};
        }
    }

    async function fetchWithTimeout(resource, options = {}) {
        const {
            timeoutMs = DEFAULT_TIMEOUT_MS,
            signal: externalSignal,
            ...fetchOptions
        } = options;
        const controller = new AbortController();
        const detachExternalSignal = createCombinedSignal(controller, externalSignal);
        const timeoutId = window.setTimeout(
            () => controller.abort(new DOMException('Request timeout', 'TimeoutError')),
            Math.max(1, timeoutMs)
        );

        try {
            return await fetch(resource, {
                ...fetchOptions,
                signal: controller.signal
            });
        } catch (error) {
            if (controller.signal.aborted && !externalSignal?.aborted) {
                throw new AppRequestError(
                    'Waktu permintaan habis. Periksa koneksi Anda lalu coba lagi.',
                    { code: 'REQUEST_TIMEOUT', cause: error }
                );
            }
            if (error instanceof AppRequestError) throw error;
            throw new AppRequestError(
                'Tidak dapat terhubung ke server. Periksa koneksi internet Anda.',
                { code: 'NETWORK_ERROR', cause: error }
            );
        } finally {
            window.clearTimeout(timeoutId);
            detachExternalSignal();
        }
    }

    async function requestJson(resource, options = {}) {
        const response = await fetchWithTimeout(resource, options);
        const contentType = response.headers.get('content-type') || '';
        let payload = null;
        try {
            payload = contentType.includes('application/json')
                ? await response.json()
                : await response.text();
        } catch (error) {
            throw new AppRequestError('Respons server tidak dapat dibaca.', {
                code: 'INVALID_RESPONSE',
                status: response.status,
                cause: error
            });
        }

        if (!response.ok) {
            const message = payload && typeof payload === 'object'
                ? payload.message
                : String(payload || '');
            throw new AppRequestError(message || `Server merespons dengan status ${response.status}.`, {
                code: payload?.code || 'HTTP_ERROR',
                status: response.status,
                payload
            });
        }

        return payload;
    }

    function uploadWithProgress(resource, options = {}) {
        const {
            method = 'POST',
            body,
            headers = {},
            timeoutMs = DEFAULT_TIMEOUT_MS,
            onProgress
        } = options;

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open(method, resource, true);
            xhr.timeout = timeoutMs;
            Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));

            xhr.upload.addEventListener('progress', event => {
                if (!event.lengthComputable || typeof onProgress !== 'function') return;
                onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
            });
            xhr.addEventListener('load', () => {
                let payload = null;
                try {
                    payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
                } catch {
                    payload = { message: xhr.responseText };
                }
                resolve({
                    ok: xhr.status >= 200 && xhr.status < 300,
                    status: xhr.status,
                    data: payload
                });
            });
            xhr.addEventListener('timeout', () => {
                reject(new AppRequestError(
                    'Waktu unggah habis. Periksa koneksi Anda lalu coba lagi.',
                    { code: 'REQUEST_TIMEOUT' }
                ));
            });
            xhr.addEventListener('error', () => {
                reject(new AppRequestError(
                    'File gagal diunggah karena koneksi ke server terputus.',
                    { code: 'NETWORK_ERROR' }
                ));
            });
            xhr.addEventListener('abort', () => {
                reject(new AppRequestError('Unggahan dibatalkan.', { code: 'REQUEST_ABORTED' }));
            });
            xhr.send(body);
        });
    }

    async function responseError(response, fallback = 'Permintaan gagal diproses.') {
        const payload = await parseErrorPayload(response);
        return new AppRequestError(payload.message || fallback, {
            code: payload.code || 'HTTP_ERROR',
            status: response.status,
            payload
        });
    }

    function errorMessage(error, fallback = 'Terjadi kesalahan. Silakan coba lagi.') {
        if (error instanceof AppRequestError) return error.message || fallback;
        if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
            return 'Waktu permintaan habis. Periksa koneksi Anda lalu coba lagi.';
        }
        return error?.message || fallback;
    }

    async function renderList(container, items, renderItem, options = {}) {
        if (!container) return;
        const rows = Array.isArray(items) ? items : [];
        const generation = (renderGenerations.get(container) || 0) + 1;
        const chunkSize = Math.max(10, Number(options.chunkSize) || 50);
        renderGenerations.set(container, generation);

        if (rows.length === 0) {
            container.innerHTML = options.emptyHtml || '';
            return;
        }

        container.innerHTML = '';
        for (let start = 0; start < rows.length; start += chunkSize) {
            if (renderGenerations.get(container) !== generation) return;
            const html = rows
                .slice(start, start + chunkSize)
                .map((item, index) => renderItem(item, start + index))
                .join('');
            container.insertAdjacentHTML('beforeend', html);
            if (start + chunkSize < rows.length) {
                await new Promise(resolve => window.requestAnimationFrame(resolve));
            }
        }
    }

    window.AppAsync = Object.freeze({
        DEFAULT_TIMEOUT_MS,
        AppRequestError,
        fetchWithTimeout,
        requestJson,
        uploadWithProgress,
        responseError,
        errorMessage,
        startOperation,
        finishOperation,
        setButtonLoading,
        isBusy,
        renderList
    });
})();
