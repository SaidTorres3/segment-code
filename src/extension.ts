import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('extension.separate', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {return;}

		const originalText = editor.document.getText();
		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		const startLine = editor.document.lineAt(selection.start.line);

		const matches = [];
		const regex = new RegExp(selectedText, 'g');
		let match;
		while ((match = regex.exec(originalText)) !== null) {
			const line = editor.document.positionAt(match.index).line;
			matches.push(line);
		}

		const matchPosition = matches.indexOf(startLine.lineNumber);

		try {
			const doc = await vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId });
			const newEditor = await vscode.window.showTextDocument(doc, { preview: false });

			const updateOriginalDocument = vscode.workspace.onDidChangeTextDocument(event => {
				if (event.document === newEditor.document) {
					const edit = new vscode.WorkspaceEdit();

					const newText = event.document.getText();

					let matchCount = -1;
					console.log("Match position (once): ", matchPosition);

					const escapedSelectedText = escapeRegExp(selectedText);
					const globalRegex = new RegExp(escapedSelectedText, 'g');

					let modifiedText = originalText.replace(globalRegex, (match) => {
						matchCount++;
						console.log("Match: ", match);
						console.log("Match count: ", matchCount);
						return (matchCount === matchPosition) ? newText : match;
					});

					console.log(modifiedText);

					const allTextRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(editor.document.lineCount + 1, 0));
					edit.replace(editor.document.uri, allTextRange, modifiedText);

					vscode.workspace.applyEdit(edit);
				}
			});

			context.subscriptions.push(updateOriginalDocument);
		} catch (error) {
			console.error('Error occurred:', error);
		}
	});

	context.subscriptions.push(disposable);
}

function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate() { }
