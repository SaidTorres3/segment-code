import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('extension.separate', () => {
		// There are editor and newEditor. Editor is the original code where the code got extracted; newEditor is the new tab where is only the extracted code.
		const editor = vscode.window.activeTextEditor;

		if (editor) {
			const originalText = editor.document.getText();
			const selection = editor.selection;
			const selectedText = editor.document.getText(selection);

			// locate the line where the selected text starts
			const startLine = editor.document.lineAt(selection.start.line);

			// find all matches of the selected text in the original text and get the lines where they start
			const matches = [];
			const regex = new RegExp(selectedText, 'g');
			let match;
			while ((match = regex.exec(originalText)) !== null) {
				const line = editor.document.positionAt(match.index).line;
				matches.push(line);
			}

			const matchPosition = matches.indexOf(startLine.lineNumber);

			vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId })
				.then(doc => {
					vscode.window.showTextDocument(doc, { preview: false })
						.then(newEditor => {
							const originalUri = editor.document.uri;

							const updateOriginalDocument = vscode.workspace.onDidChangeTextDocument(event => {
								if (event.document === newEditor.document) {
									const edit = new vscode.WorkspaceEdit();

									const newText = event.document.getText();
									// We will get all the matches of the selectedText in the originalText, but we only want to replace the selectedText with the newText in the match that is in the same line as the selectedText.
									let matchCount = -1;
									let modifiedText = originalText.replace(selectedText, (match) => {
										matchCount++;
										if (matchCount === matchPosition) {
											return newText; // Replace the second match
										} else {
											return match; // Keep other matches as they are
										}
									});

									console.log(modifiedText);

									const allTextRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount + 1, 0));
									edit.replace(originalUri, allTextRange, modifiedText);
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
