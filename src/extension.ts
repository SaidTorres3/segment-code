import * as vscode from 'vscode';
import * as _ from 'lodash';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.separate', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) { return; };

			const originalText = editor.document.getText();
			const selectedText = editor.document.getText(editor.selection);
			const startLine = editor.document.lineAt(editor.selection.start.line);

			const matches = Array.from(originalText.matchAll(new RegExp(escapeRegExp(selectedText), 'g'))).map(match => editor.document.positionAt(match.index!).line);

			try {
				const doc = await vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId });
				const newEditor = await vscode.window.showTextDocument(doc, { preview: false });

				const debouncedHandleTextChange = _.debounce(async (event: any) => {
					if (event.document === newEditor.document && !event.document.isClosed) {
						console.log(event.document.isClosed);
						console.log(event);
						const newText = event.document.getText();
						const modifiedText = replaceNthOccurrence(originalText, escapeRegExp(selectedText), newText, matches.indexOf(startLine.lineNumber));
						const allTextRange = new vscode.Range(0, 0, editor.document.lineCount + 1, 0);
						const edit = new vscode.WorkspaceEdit();
						edit.replace(editor.document.uri, allTextRange, modifiedText);
						vscode.workspace.applyEdit(edit);
					}
				}, 111);

				context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(debouncedHandleTextChange));
			} catch (error) {
				console.error('Error occurred:', error);
			}

		})
	);
}

function escapeRegExp(string: string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceNthOccurrence(original: string, search: string, replacement: string, n: number) {
	let i = 0;
	return original.replace(new RegExp(search, 'g'), (match) => (i++ === n ? replacement : match));
}

export function deactivate() { }
