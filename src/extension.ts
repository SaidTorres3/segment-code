import * as vscode from 'vscode';
import * as _ from 'lodash';

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.separate', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) { return; }

			const originalText = editor.document.getText();
			const selectedText = editor.document.getText(editor.selection);
			const startLine = editor.document.lineAt(editor.selection.start.line);
			const matches = Array.from(originalText.matchAll(new RegExp(escapeRegExp(selectedText), 'g')))
				.map(match => editor.document.positionAt(match.index!).line);

			try {
				const doc = await vscode.workspace.openTextDocument({ content: selectedText, language: editor.document.languageId });
				const newEditor = await vscode.window.showTextDocument(doc, { preview: false });

				let lastOriginalText = originalText;
				let lastSelectedText = selectedText;

				const debouncedHandleTextChange = _.debounce(async (event: vscode.TextDocumentChangeEvent) => {
					if (event.document === newEditor.document && !event.document.isClosed) {
						const currentOriginalText = editor.document.getText();
						const newText = event.document.getText();

						// Check if the original document has changed
						if (currentOriginalText !== lastOriginalText) {
							// Merge changes from both documents
							const mergedText = mergeChanges(lastOriginalText, currentOriginalText, lastSelectedText, newText);

							const allTextRange = new vscode.Range(0, 0, editor.document.lineCount + 1, 0);
							const edit = new vscode.WorkspaceEdit();
							edit.replace(editor.document.uri, allTextRange, mergedText);
							await vscode.workspace.applyEdit(edit);

							// Update the content in the new tab
							const newTabEdit = new vscode.WorkspaceEdit();
							const newTabAllTextRange = new vscode.Range(0, 0, newEditor.document.lineCount + 1, 0);
							newTabEdit.replace(newEditor.document.uri, newTabAllTextRange, newText);
							await vscode.workspace.applyEdit(newTabEdit);
						} else {
							// If only the new tab has changed, update the original document
							const modifiedText = replaceNthOccurrence(currentOriginalText, escapeRegExp(lastSelectedText), newText, matches.indexOf(startLine.lineNumber));

							const allTextRange = new vscode.Range(0, 0, editor.document.lineCount + 1, 0);
							const edit = new vscode.WorkspaceEdit();
							edit.replace(editor.document.uri, allTextRange, modifiedText);
							await vscode.workspace.applyEdit(edit);
						}

						// Update the last known states
						lastOriginalText = editor.document.getText();
						lastSelectedText = newText;
					}
				}, 300);

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

function mergeChanges(originalOld: string, originalNew: string, selectedOld: string, selectedNew: string): string {
	// Find the differences between the old and new original texts
	const originalDiff = findDifference(originalOld, originalNew);

	// Apply these differences to the new selected text
	let mergedText = originalNew;
	const searchRegex = new RegExp(escapeRegExp(selectedOld), 'g');
	let match;
	let lastIndex = 0;
	let occurrenceIndex = 0;

	while ((match = searchRegex.exec(mergedText)) !== null) {
		if (occurrenceIndex === 0) {
			// Replace the first occurrence with the new selected text
			mergedText = mergedText.substring(0, match.index) + selectedNew + mergedText.substring(match.index + selectedOld.length);
			lastIndex = match.index + selectedNew.length;
			searchRegex.lastIndex = lastIndex;
		}
		occurrenceIndex++;
	}

	return mergedText;
}

function findDifference(oldText: string, newText: string): string {
	let i = 0;
	while (i < oldText.length && i < newText.length && oldText[i] === newText[i]) {
		i++;
	}
	return newText.slice(i);
}

export function deactivate() { }