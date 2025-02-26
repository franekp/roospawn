import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

interface StatusUpdateEvent {
    type: 'status_updated';
    html: string;
}

interface StatusData {
    html: string;
}

export const activate: ActivationFunction = (context: RendererContext<void>) => ({
    renderOutputItem(data: OutputItem, element: HTMLElement) {

        // Create container for the status HTML
        const container = document.createElement('div');
        container.id = 'taskdozer-status-container';
        element.appendChild(container);
        
        // Initial render
        const statusData = data.json() as StatusData;
        container.innerHTML = statusData.html;
        
        // Set up update listener if messaging is available
        if (typeof context.onDidReceiveMessage === 'function') {
            const onMessage = context.onDidReceiveMessage.bind(context);
            onMessage((event: StatusUpdateEvent) => {
                if (event.type === 'status_updated') {
                    // Update container with new HTML
                    container.innerHTML = event.html;

                    for (const elt of Array.from(container.getElementsByClassName('taskdozer-pause-button'))) {
                        const btn = elt as HTMLButtonElement;
                        const id = btn.getAttribute('data-task-id');
                        const message = { type: 'pauseTask', id };
                        btn.onclick = () => context.postMessage?.(message);
                    }
                    for (const elt of Array.from(container.getElementsByClassName('taskdozer-resume-button'))) {
                        const btn = elt as HTMLButtonElement;
                        const id = btn.getAttribute('data-task-id');
                        const message = { type: 'resumeTask', id };
                        btn.onclick = () => context.postMessage?.(message);
                    }
                }
            });
        }
    },

    disposeOutputItem(id: string) {
        // Cleanup is handled automatically by VS Code clearing the element
    }
});