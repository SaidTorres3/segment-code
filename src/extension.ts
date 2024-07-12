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
		const newEditor = await vscode.window.showTextDocument(newDoc, vscode.ViewColumn.Beside);

		// Sync changes between original and extracted documents
		const syncDocuments = (original: vscode.TextEditor, extracted: vscode.TextEditor) => {
			const originalUri = original.document.uri;
			const extractedUri = extracted.document.uri;
			let isUpdating = false;
			let originalSelection = selection;

			// Track changes in original and sync to extracted
			const originalToExtracted = vscode.workspace.onDidChangeTextDocument(originalEvent => {
				if (!isUpdating && originalEvent.document.uri.toString() === originalUri.toString()) {
					isUpdating = true;

					// Recalculate the selection range based on the changes
					const changes = originalEvent.contentChanges;
					changes.forEach(change => {
						const startLine = change.range.start.line;
						const endLine = change.range.end.line;
						const lineDelta = change.text.split('\n').length - (endLine - startLine + 1);

						if (startLine <= originalSelection.end.line) {
							let newEndLine = originalSelection.end.line + lineDelta;
							let newEndChar = originalSelection.end.character;

							if (startLine === originalSelection.end.line) {
								newEndChar += (change.text.length - change.rangeLength);
							}

							originalSelection = new vscode.Selection(
								originalSelection.start,
								new vscode.Position(newEndLine, newEndChar)
							);
						}
					});

					// Calculate the new text and update the extracted document
					const newText = original.document.getText(originalSelection);
					const edit = new vscode.WorkspaceEdit();
					edit.replace(extractedUri, new vscode.Range(new vscode.Position(0, 0), extracted.document.lineAt(extracted.document.lineCount - 1).range.end), newText);
					vscode.workspace.applyEdit(edit).then(() => {
						// Select all text in the extracted document
						const lastLine = extracted.document.lineCount - 1;
						const lastChar = extracted.document.lineAt(lastLine).text.length;
						extracted.selection = new vscode.Selection(0, 0, lastLine, lastChar);
						isUpdating = false;
					});
				}
			});

			// Track changes in extracted and sync to original
			const extractedToOriginal = vscode.workspace.onDidChangeTextDocument(extractedEvent => {
				if (!isUpdating && extractedEvent.document.uri.toString() === extractedUri.toString()) {
					isUpdating = true;
					const newText = extracted.document.getText();
					if (newText.length === 0) {
						isUpdating = false;
						return;
					}
					const edit = new vscode.WorkspaceEdit();
					edit.replace(originalUri, originalSelection, newText);
					vscode.workspace.applyEdit(edit).then(() => {
						// Adjust the selection to account for changes in length
						const newLines = newText.split('\n');
						const oldLines = original.document.getText(originalSelection).split('\n');
						const lineDelta = newLines.length - oldLines.length;

						let endLine = originalSelection.end.line + lineDelta;
						let endCharacter = newLines[newLines.length - 1].length;

						if (lineDelta === 0) {
							endCharacter = originalSelection.end.character + (newText.length - original.document.getText(originalSelection).length);
						}

						originalSelection = new vscode.Selection(
							originalSelection.start,
							new vscode.Position(endLine, endCharacter)
						);
						original.selection = originalSelection;
						isUpdating = false;
					});
				}
			});

			// Handle closing of the extracted document
			const closeHandler = vscode.workspace.onDidCloseTextDocument(async (doc) => {
				if (!doc.isClosed) { return; }
				if (doc.uri.toString() === extractedUri.toString()) {
					originalToExtracted.dispose();
					extractedToOriginal.dispose();
					closeHandler.dispose();
				}
			});

			context.subscriptions.push(originalToExtracted, extractedToOriginal, closeHandler);
		};

		syncDocuments(editor, newEditor);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }