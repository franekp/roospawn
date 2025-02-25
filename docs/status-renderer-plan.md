# TaskDozer Status Renderer Implementation Plan

## 1. Custom Mime Type

Define a custom mime type for task status:
```
application/x-taskdozer-status
```

This mime type will be used to identify task status output in notebook cells.

## 2. TaskDozer.status() Method

Add a method to TaskDozer class that returns the current status with the custom mime type:

```typescript
status(): any {
    return {
        ["application/x-taskdozer-status"]: {
            html: this.render_status_html()
        }
    };
}
```

## 3. Notebook Renderer

Create a notebook renderer that:
- Registers for the `application/x-taskdozer-status` mime type
- Uses the HTML content from the output data
- Implements live updates using the VS Code notebook renderer messaging API

### Renderer Registration (package.json)
```json
{
    "contributes": {
        "notebookRenderer": [{
            "id": "taskdozer-status-renderer",
            "displayName": "TaskDozer Status Renderer",
            "entrypoint": "./out/renderer.js",
            "mimeTypes": [
                "application/x-taskdozer-status"
            ]
        }]
    }
}
```

### Renderer Implementation Details

1. Container Initialization:
```typescript
export const activate: ActivationFunction = (context) => ({
    renderOutputItem(data, element) {
        // Create container for the status HTML
        const container = document.createElement('div');
        container.id = 'taskdozer-status-container';
        element.appendChild(container);
        
        // Initial render
        const statusData = data.json();
        container.innerHTML = statusData.html;
        
        // Set up update listener
        if (context.postMessage) {
            context.onDidReceiveMessage(event => {
                if (event.type === 'status_updated') {
                    // Update container with new HTML
                    container.innerHTML = event.html;
                }
            });
        }
    }
});
```

2. Extension Host Communication:
```typescript
// In extension.ts
const messageChannel = notebooks.createRendererMessaging('taskdozer-status-renderer');

// When tasks are updated
this._tasks_updated.event(() => {
    messageChannel.postMessage({
        type: 'status_updated',
        html: this.render_status_html()
    });
});
```

3. Cleanup on Dispose:
```typescript
disposeOutputItem(id) {
    // Any cleanup needed when output is disposed
}
```

## 4. Extension Host Integration

1. Set up communication channel between the renderer and extension:
```typescript
const messageChannel = notebooks.createRendererMessaging('taskdozer-status-renderer');
```

2. Send status updates when tasks change:
```typescript
this._tasks_updated.event(() => {
    messageChannel.postMessage({
        type: 'status_updated',
        html: this.render_status_html()
    });
});
```

## Implementation Steps

1. Add status() method to TaskDozer class
2. Create renderer implementation files:
   - src/renderer/taskdozer-status.ts (main renderer code)
   - src/renderer/index.ts (entry point)
3. Update package.json with renderer contribution
4. Implement extension host messaging
5. Test with sample notebook cells

## Testing Scenarios

1. Basic rendering:
   ```python
   taskdozer.status()
   ```

2. Live updates:
   - Add new task
   - Complete task
   - Pause task
   - Verify renderer updates automatically

## Notes

- The renderer maintains a container element for the HTML content
- Updates are handled by replacing the container's innerHTML
- The container is properly initialized before any updates occur
- The messaging system ensures live updates without manual refresh
- Proper cleanup is implemented in the dispose handler