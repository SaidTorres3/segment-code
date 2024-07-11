import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {

	const disposable = vscode.commands.registerCommand('extension.separate', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		// Open a new tab with the selected text
		const newDoc = await vscode.workspace.openTextDocument({
			content: selectedText,
			language: editor.document.languageId
		});
		const newEditor = await vscode.window.showTextDocument(newDoc);

		// Sync changes between original and extracted documents
		const syncDocuments = (original: vscode.TextEditor, extracted: vscode.TextEditor) => {
			const originalUri = original.document.uri;
			const extractedUri = extracted.document.uri;

			// Track changes in original and sync to extracted
			const originalToExtracted = vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document.uri.toString() === originalUri.toString()) {
					const newText = original.document.getText(selection);
					const edit = new vscode.WorkspaceEdit();
					edit.replace(extractedUri, new vscode.Range(new vscode.Position(0, 0), extracted.document.lineAt(extracted.document.lineCount - 1).range.end), newText);
					vscode.workspace.applyEdit(edit);
				}
			});

			// Track changes in extracted and sync to original
			const extractedToOriginal = vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document.uri.toString() === extractedUri.toString()) {
					const newText = extracted.document.getText();
					const edit = new vscode.WorkspaceEdit();
					edit.replace(originalUri, selection, newText);
					vscode.workspace.applyEdit(edit);

					// Adjust the selection to account for changes in length
					const newLines = newText.split('\n').length;
					const oldLines = selectedText.split('\n').length;
					const lineDelta = newLines - oldLines;
					const newSelection = new vscode.Selection(
						selection.start.line,
						selection.start.character,
						selection.end.line + lineDelta,
						selection.end.character
					);
					editor.selection = newSelection;
				}
			});

			context.subscriptions.push(originalToExtracted, extractedToOriginal);
		};

		syncDocuments(editor, newEditor);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
