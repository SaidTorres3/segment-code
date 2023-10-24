import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('extension.separate', () => {
		// There are editor and newEditor. Editor is the original code where the code got extracted; newEditor is the new tab where is only the extracted code.
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			const originalText = editor.document.getText();
			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);
			const range = new vscode.Range(selection.start, selection.end);

			vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId })
				.then(doc => {
					vscode.window.showTextDocument(doc, { preview: false })
						.then(newEditor => {
							const originalUri = editor.document.uri;

							const updateOriginalDocument = vscode.workspace.onDidChangeTextDocument(event => {
								if (event.document === newEditor.document) {
									const edit = new vscode.WorkspaceEdit();

									const newText = event.document.getText();
									const modifiedText = originalText.replace(selectedText, newText);

									// replace all the original text with the modified text
									const allTextRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount + 1, 0));
									edit.replace(originalUri, allTextRange, modifiedText);

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
