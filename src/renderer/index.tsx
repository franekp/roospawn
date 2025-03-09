import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import type { RendererInitializationData } from '../shared';
import TaskList from './task_list';


export const activate: ActivationFunction = (context: RendererContext<void>) => ({
    renderOutputItem(data: OutputItem, element: HTMLElement) {
        const initializationData = data.json() as RendererInitializationData;

        // remove annoying orange outline that sometimes appears
        // apparently, it's from user agent stylesheet of chrome and VS Code is setting
        // tabindex on it, so chrome thinks it must highlight it when clicked inside
        // user agent stylesheet contains this:
        // :focus-visible {
        //     outline: -webkit-focus-ring-color auto 1px;
        // }
        element.style.outline = 'none';

        let shadow = element.shadowRoot;
        if (!shadow) {
            shadow = element.attachShadow({ mode: 'open' });
            const root = document.createElement('div');
            root.id = 'root';
            shadow.append(root);
        }

        const root = shadow.querySelector<HTMLElement>('#root');
        if (!root) {
            throw new Error('Could not find root element');
        }

        ReactDOM.createRoot(root).render(<TaskList tasks={initializationData.tasks} workerActive={initializationData.workerActive} context={context} />);
    },

    disposeOutputItem(id: string) {
        // Cleanup is handled automatically by VS Code clearing the element
    }
});
