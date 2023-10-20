import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('extension.separate', () => {
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);

			vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId })
				.then(doc => {
					vscode.window.showTextDocument(doc, { preview: false })
						.then(newEditor => {
							const originalUri = editor.document.uri;
							const range = new vscode.Range(selection.start, selection.end);

							const updateOriginalDocument = vscode.workspace.onDidChangeTextDocument(event => {
								if (event.document === newEditor.document) {
									const newText = event.document.getText();
									const edit = new vscode.WorkspaceEdit();
									edit.replace(originalUri, range, newText);
									vscode.workspace.applyEdit(edit);
								}
							});

							context.subscriptions.push(updateOriginalDocument);
						});
				});
		}
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
