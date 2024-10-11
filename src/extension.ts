import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);

// A map to keep track of active temporary tabs for each original document
const activeTempTabs: Map<string, TempTab> = new Map();

// Debounce timer map to prevent rapid successive command executions
const debounceTimers: Map<string, NodeJS.Timeout> = new Map();

// Define a debounce delay in milliseconds
const DEBOUNCE_DELAY = 10;

// Interface to store temporary tab information
interface TempTab {
	tempFileName: string;
	tempUri: vscode.Uri;
	originalUri: string;
	disposables: vscode.Disposable[];
	isProgrammaticSave: boolean;
	isClosed: boolean; // Added to track if the tab was manually closed
	originalSelection: vscode.Selection;
}

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('extension.separate', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		if (selection.isEmpty) {
			vscode.window.showInformationMessage('Please select some text to separate.');
			return;
		}

		const selectedText = editor.document.getText(selection);
		if (selectedText.trim().length === 0) {
			vscode.window.showInformationMessage('Selected text is empty.');
			return;
		}

		const originalUri = editor.document.uri.toString();

		// Implement debounce to prevent rapid successive executions
		if (debounceTimers.has(originalUri)) {
			clearTimeout(debounceTimers.get(originalUri)!);
		}

		const timer = setTimeout(async () => {
			debounceTimers.delete(originalUri);

			// Check if the temp tab was previously closed by the user
			if (activeTempTabs.has(originalUri)) {
				const existingTempTab = activeTempTabs.get(originalUri)!;
				if (existingTempTab.isClosed) {
					// Do not recreate the temp tab if it was closed by the user
					return;
				}
				// Dispose of existing TempTab if it exists
				existingTempTab.disposables.forEach(disposable => disposable.dispose());
				// Clean up temporary files
				try {
					await unlinkAsync(existingTempTab.tempFileName);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to delete previous temporary file: ${error}`);
				}
				activeTempTabs.delete(originalUri);
			}

			// Determine the original file extension
			const originalExtension = getFileExtension(editor.document.uri);

			// Create a temporary file with a unique name and the same extension as the original
			const tempFileName = path.join(os.tmpdir(), `separate-${Date.now()}${originalExtension ? `.${originalExtension}` : ''}`);
			try {
				await writeFileAsync(tempFileName, selectedText);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create temporary file: ${error}`);
				return;
			}

			const tempUri = vscode.Uri.file(tempFileName);

			// Open the temporary file in a new editor
			let newDoc: vscode.TextDocument;
			try {
				newDoc = await vscode.workspace.openTextDocument(tempUri);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open temporary file: ${error}`);
				return;
			}

			// Ensure the language mode matches the original
			if (editor.document.languageId) {
				await vscode.languages.setTextDocumentLanguage(newDoc, editor.document.languageId);
			}

			try {
				await vscode.window.showTextDocument(newDoc, vscode.ViewColumn.Beside, false);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to show temporary document: ${error}`);
				return;
			}

			// Create a TempTab object to keep track
			const tempTab: TempTab = {
				tempFileName,
				tempUri,
				originalUri,
				disposables: [],
				isProgrammaticSave: false,
				isClosed: false, // Initialize isClosed to false
				originalSelection: selection, // Store the original selection
			};

			activeTempTabs.set(originalUri, tempTab);

			// Sync changes between original and extracted documents
			syncDocuments(editor.document, newDoc, tempTab);
		}, DEBOUNCE_DELAY);

		debounceTimers.set(originalUri, timer);
	});

	context.subscriptions.push(disposable);

	// Global listener for save events
	const saveListener = vscode.workspace.onDidSaveTextDocument(async (doc) => {
		// Iterate through activeTempTabs to check if the saved doc is a temporary tab
		activeTempTabs.forEach(async (tempTab) => {
			if (doc.uri.fsPath === tempTab.tempUri.fsPath) {
				if (!tempTab.isProgrammaticSave) {
					// User manually saved the temporary document, save the original document
					const originalDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === tempTab.originalUri);
					if (originalDoc) {
						try {
							await originalDoc.save();
							vscode.window.showInformationMessage('Original document saved successfully.');
						} catch (error) {
							vscode.window.showErrorMessage(`Failed to save original document: ${error}`);
						}
					}
				}
			}
		});
	});
	context.subscriptions.push(saveListener);
}

export function deactivate() {
	// Clean up all active temporary tabs on extension deactivation
	activeTempTabs.forEach(async (tempTab) => {
		try {
			await unlinkAsync(tempTab.tempFileName);
		} catch (error) {
			console.error(`Failed to delete temporary file during deactivation: ${error}`);
		}
		tempTab.disposables.forEach(disposable => disposable.dispose());
	});
}

// Helper function to get file extension from a URI
function getFileExtension(uri: vscode.Uri): string | null {
	const ext = path.extname(uri.fsPath);
	if (ext.startsWith('.')) {
		return ext.slice(1);
	}
	return null;
}

function debounce(func: (...args: any[]) => void, delay: number) {
	let timer: NodeJS.Timeout;
	return (...args: any[]) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			func(...args);
		}, delay);
	};
}

function syncDocuments(originalDoc: vscode.TextDocument, extractedDoc: vscode.TextDocument, tempTab: TempTab) {
	let isUpdating = false;
	let originalSelection = tempTab.originalSelection;

	// Debounce the autosave function with a delay of 300ms (adjust as needed)
	const debouncedAutosave = debounce(async () => {
		// Only proceed with autosaving if the tab isn't closed
		if (tempTab.isClosed) return; // Skip saving if the temp tab is closed

		tempTab.isProgrammaticSave = true;
		try {
			await extractedDoc.save();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to save temporary file: ${error}`);
		} finally {
			tempTab.isProgrammaticSave = false;
		}
	}, 300);

	// Track changes in the original document and sync to the extracted document
	const originalToExtracted = vscode.workspace.onDidChangeTextDocument(async originalEvent => {
		// Do not sync if the temp tab is closed
		if (tempTab.isClosed) return;

		if (!isUpdating && originalEvent.document.uri.toString() === originalDoc.uri.toString()) {
			isUpdating = true;

			// Initialize cumulative line delta
			let cumulativeLineDelta = 0;

			// Recalculate selection range based on all changes
			originalEvent.contentChanges.forEach(change => {
				const changeStartLine = change.range.start.line;
				const changeEndLine = change.range.end.line;
				const changeLineDelta = change.text.split('\n').length - (changeEndLine - changeStartLine + 1);

				if (changeEndLine < originalSelection.start.line) {
					// Change is entirely before the selection
					cumulativeLineDelta += changeLineDelta;

					originalSelection = new vscode.Selection(
						new vscode.Position(
							originalSelection.start.line + changeLineDelta,
							originalSelection.start.character
						),
						new vscode.Position(
							originalSelection.end.line + changeLineDelta,
							originalSelection.end.character
						)
					);
				} else if (changeStartLine <= originalSelection.end.line) {
					// Change affects the selection
					cumulativeLineDelta += changeLineDelta;

					let newEndLine = originalSelection.end.line + changeLineDelta;
					let newEndChar = originalSelection.end.character;

					// Adjust end character if the change is on the last line of the selection
					if (changeStartLine === originalSelection.end.line) {
						newEndChar += (change.text.length - change.rangeLength);
						if (newEndChar < 0) newEndChar = 0; // Prevent negative character positions
					}

					originalSelection = new vscode.Selection(
						originalSelection.start,
						new vscode.Position(newEndLine, newEndChar)
					);
				}
				// Changes after the selection do not affect the current selection
			});

			// Get the new text from the original and update the extracted document
			const newText = originalDoc.getText(originalSelection);

			// Create a workspace edit to update the extracted document
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				extractedDoc.positionAt(0),
				extractedDoc.positionAt(extractedDoc.getText().length)
			);
			edit.replace(extractedDoc.uri, fullRange, newText);
			await vscode.workspace.applyEdit(edit);

			// Trigger debounced autosave
			debouncedAutosave();

			isUpdating = false;
		}
	});

	// Track changes in the extracted document and sync to the original document
	const extractedToOriginal = vscode.workspace.onDidChangeTextDocument(async extractedEvent => {
		// Do not sync if the temp tab is closed
		if (tempTab.isClosed) return;

		if (!isUpdating && extractedEvent.document.uri.toString() === extractedDoc.uri.toString()) {
			isUpdating = true;
			const newText = extractedDoc.getText();
			if (newText.length === 0) {
				isUpdating = false;
				return;
			}

			// Update the original document with the changes from the extracted document
			// Create a workspace edit to update the original document
			const edit = new vscode.WorkspaceEdit();
			edit.replace(originalDoc.uri, originalSelection, newText);
			await vscode.workspace.applyEdit(edit);

			// Adjust the selection to account for changes in length
			const newLines = newText.split('\n');
			const oldLines = originalDoc.getText(originalSelection).split('\n');
			const lineDelta = newLines.length - oldLines.length;

			let endLine = originalSelection.end.line + lineDelta;
			let endCharacter = newLines[newLines.length - 1].length;

			if (lineDelta === 0) {
				endCharacter = originalSelection.end.character + (newText.length - originalDoc.getText(originalSelection).length);
				if (endCharacter < 0) endCharacter = 0; // Prevent negative character positions
			}

			originalSelection = new vscode.Selection(
				originalSelection.start,
				new vscode.Position(endLine, endCharacter)
			);

			// Update the original selection in tempTab
			tempTab.originalSelection = originalSelection;

			// Trigger debounced autosave
			debouncedAutosave();

			isUpdating = false;
		}
	});

	// Handle closing of the extracted document
	const closeHandler = vscode.workspace.onDidCloseTextDocument(async (doc) => {
		if (doc.uri.toString() === extractedDoc.uri.toString()) {
			// Check if the document is still open (e.g., reopened due to language change)
			const isStillOpen = vscode.workspace.textDocuments.some(d => d.uri.toString() === doc.uri.toString());
			if (isStillOpen) {
				// The document is still open, do not clean up
				return;
			}

			// Mark the temp tab as closed
			tempTab.isClosed = true;

			// Dispose of all disposables for this tempTab
			tempTab.disposables.forEach(disposable => disposable.dispose());

			// Clean up temporary files if any
			try {
				await unlinkAsync(tempTab.tempFileName);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete temporary file: ${error}`);
			}

			// Remove the temp tab from the active list
			activeTempTabs.delete(tempTab.originalUri);
		}
	});

	// Add all listeners to the tempTab's disposables
	tempTab.disposables.push(originalToExtracted, extractedToOriginal, closeHandler);
}
