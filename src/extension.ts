// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ai-todos" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ai-todos.helloWorld', async () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		console.log('Hello World from AI TODOs!');

		let ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
		if (!ai_extension) {
			throw new Error('ai-todos: roo-cline extension not found');
		}
		let ai_api = ai_extension.exports;
		await ai_api.startNewTask("Write a function that calculates factorial in TypeScript");
		//await ai_api.sendMessage("I need to write a function that calculates factorial in TypeScript");
		
		console.log('Run the query!');
	});

	let ai_extension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
	console.log(ai_extension);

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
