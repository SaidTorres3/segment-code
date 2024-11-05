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

// Define decoration types for original editor
const originalDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(135,206,250, 0.3)', // Light sky blue with transparency
	borderRadius: '2px',
});

// Interface to store temporary tab information
interface TempTab {
	tempFileName: string;
	tempUri: vscode.Uri;
	originalUri: string;
	disposables: vscode.Disposable[];
	isProgrammaticSave: boolean;
	isClosed: boolean;
	originalRange: vscode.Range; // Changed from Selection to Range
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
				isClosed: false,
				originalRange: selection, // Changed from Selection to Range
			};

			activeTempTabs.set(originalUri, tempTab);

			// Sync changes between original and extracted documents
			syncDocuments(editor.document, newDoc, tempTab);
		}, DEBOUNCE_DELAY);

		debounceTimers.set(originalUri, timer);
	});

	context.subscriptions.push(disposable);

	// Register decoration types for disposal
	context.subscriptions.push(originalDecorationType);

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
	let originalRange = tempTab.originalRange;
	let pendingChanges: vscode.TextDocumentContentChangeEvent[] = [];
	let processingTimeout: NodeJS.Timeout | null = null;

	// Debounce the autosave function with a delay of 300ms
	const debouncedAutosave = debounce(async () => {
		if (tempTab.isClosed) { return; }

		tempTab.isProgrammaticSave = true;
		try {
			await extractedDoc.save();
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to save temporary file: ${error}`);
		} finally {
			tempTab.isProgrammaticSave = false;
		}
	}, 300);

	// Function to update decorations
	const updateDecorations = () => {
		const originalEditor = vscode.window.visibleTextEditors.find(
			editor => editor.document.uri.toString() === originalDoc.uri.toString()
		);
		// No need to find extractedEditor since we're not using decorations there

		if (originalEditor) {
			// Remove existing decorations
			originalEditor.setDecorations(originalDecorationType, []);

			// Define new decoration ranges
			const originalRangeDeco = new vscode.Range(originalRange.start, originalRange.end);

			// Apply new decorations
			originalEditor.setDecorations(originalDecorationType, [originalRangeDeco]);
		}
	};

	// Function to clear decorations
	const clearDecorations = () => {
		const originalEditor = vscode.window.visibleTextEditors.find(
			editor => editor.document.uri.toString() === originalDoc.uri.toString()
		);

		if (originalEditor) {
			originalEditor.setDecorations(originalDecorationType, []);
		}
	};

	// Initially apply decorations
	updateDecorations();

	// Calculate position adjustment based on line deletion
	const calculatePositionAdjustment = (
		position: vscode.Position,
		changeStart: vscode.Position,
		changeEnd: vscode.Position,
		changeText: string
	): vscode.Position => {
		// If change is before the position's line, adjust the line number
		if (changeEnd.line < position.line) {
			const deletedLines = changeEnd.line - changeStart.line;
			const addedLines = changeText.split('\n').length - 1;
			const lineDelta = addedLines - deletedLines;
			return position.translate(lineDelta, 0);
		}

		// If change is on the same line as position
		if (changeStart.line === position.line) {
			const deletedText = originalDoc.getText(new vscode.Range(changeStart, changeEnd));
			const newTextLength = changeText.length - deletedText.length;
			if (changeStart.character < position.character) {
				return position.translate(0, newTextLength);
			}
		}

		return position;
	};

	// Check if a position is within a range
	const isPositionWithinRange = (position: vscode.Position, start: vscode.Position, end: vscode.Position): boolean => {
		return (position.line > start.line || (position.line === start.line && position.character >= start.character)) &&
			(position.line < end.line || (position.line === end.line && position.character <= end.character));
	};

	// Process pending changes in a batch
	const processPendingChanges = async () => {
		if (!originalDoc || originalDoc.isClosed || pendingChanges.length === 0) return;

		const changes = [...pendingChanges];
		pendingChanges = [];

		let newStart = originalRange.start;
		let newEnd = originalRange.end;

		for (const change of changes) {
			const changeStart = change.range.start;
			const changeEnd = change.range.end;
			const changeLines = change.text.split('\n');
			const changeLineCount = changeLines.length - 1;
			const lastLineLength = changeLines[changeLines.length - 1].length;

			// Check if change is within the original range
			const isWithinRange = isPositionWithinRange(changeStart, originalRange.start, originalRange.end);
			const isAtRangeEnd = changeStart.line === originalRange.end.line &&
				Math.abs(changeStart.character - originalRange.end.character) <= 1;

			if (isWithinRange || isAtRangeEnd) {
				// Calculate the change in text length
				const oldTextLength = changeEnd.character - changeStart.character;
				const newTextLength = change.text.length;
				const lineDelta = changeLineCount;

				// If it's a new line insertion within range
				if (lineDelta > 0 && isWithinRange) {
					// Adjust the end position based on new lines added
					newEnd = newEnd.translate(lineDelta, lastLineLength);
				} else if (isAtRangeEnd) {
					// For changes at range end
					newEnd = newEnd.translate(
						changeLineCount,
						changeLineCount === 0 ?
							newEnd.character + newTextLength - oldTextLength :
							lastLineLength
					);
				}
			} else {
				// Handle changes outside the original range
				newStart = calculatePositionAdjustment(newStart, changeStart, changeEnd, change.text);
				newEnd = calculatePositionAdjustment(newEnd, changeStart, changeEnd, change.text);

				// Additional check for changes that affect the range content
				if (changeStart.isBeforeOrEqual(newEnd) && changeEnd.isAfterOrEqual(newStart)) {
					if (changeStart.isBefore(newStart)) {
						newStart = changeStart;
					}

					const endLineDelta = changeLineCount;
					const endCharDelta = changeLineCount === 0 ?
						change.text.length - (changeEnd.character - changeStart.character) :
						lastLineLength;

					if (changeEnd.translate(0, endCharDelta).isAfter(newEnd)) {
						newEnd = changeEnd.translate(0, endCharDelta);
					}
				}
			}
		}

		// Update the original range with new positions
		originalRange = new vscode.Range(newStart, newEnd);

		// Get the new text from the original and update the extracted document
		const newText = originalDoc.getText(originalRange);

		// Create a workspace edit to update the extracted document
		const edit = new vscode.WorkspaceEdit();
		const fullRange = new vscode.Range(
			extractedDoc.positionAt(0),
			extractedDoc.positionAt(extractedDoc.getText().length)
		);
		edit.replace(extractedDoc.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);

		// Update tempTab's originalRange
		tempTab.originalRange = originalRange;

		// Update decorations with the new range
		updateDecorations();

		// Trigger debounced autosave
		debouncedAutosave();
	};

	// Track changes in the original document and sync to the extracted document
	const originalToExtracted = vscode.workspace.onDidChangeTextDocument(async originalEvent => {
		if (tempTab.isClosed || isUpdating ||
			originalEvent.document.uri.toString() !== originalDoc.uri.toString()) {
			return;
		}

		isUpdating = true;

		// Add new changes to pending changes
		pendingChanges.push(...originalEvent.contentChanges);

		// Clear existing timeout if any
		if (processingTimeout) {
			clearTimeout(processingTimeout);
		}

		// Process changes after a short delay to batch multiple rapid changes
		processingTimeout = setTimeout(async () => {
			await processPendingChanges();
			processingTimeout = null;
			isUpdating = false;
			updateDecorations();
		}, 10);
	});

	// Track changes in the extracted document and sync to the original document
	const extractedToOriginal = vscode.workspace.onDidChangeTextDocument(async extractedEvent => {
		if (tempTab.isClosed || isUpdating ||
			extractedEvent.document.uri.toString() !== extractedDoc.uri.toString()) {
			return;
		}

		isUpdating = true;

		const newText = extractedDoc.getText();
		const newLines = newText.split('\n');

		// Replace the text in the original document within the original range
		const edit = new vscode.WorkspaceEdit();
		edit.replace(originalDoc.uri, originalRange, newText);
		await vscode.workspace.applyEdit(edit);

		// Calculate the new end position considering line breaks
		const lineCount = newLines.length - 1;
		const lastLineLength = newLines[newLines.length - 1].length;
		const newEndPosition = originalRange.start.translate(
			lineCount,
			lineCount === 0 ? newText.length : lastLineLength
		);
		originalRange = new vscode.Range(originalRange.start, newEndPosition);

		// Update tempTab's originalRange
		tempTab.originalRange = originalRange;

		// Update decorations with the new range
		updateDecorations();

		// Trigger debounced autosave
		debouncedAutosave();

		isUpdating = false;
	});

	const closeHandler = vscode.window.onDidChangeVisibleTextEditors(async () => {
		const allTabs = vscode.window.tabGroups.all.map(group => group.tabs).flat();

		// Convert the temp file path to a vscode URI for a more accurate comparison
		const tempFileUri = vscode.Uri.file(tempTab.tempFileName);

		// Check if the temporary file is still open in any of the tabs
		const isExtractedDocVisible = allTabs.some(tab => {
			const tabUri = tab.input instanceof vscode.TabInputText ? tab.input.uri : null;
			return tabUri && tabUri.toString().toLowerCase() === tempFileUri.toString().toLowerCase();
		});

		if (!isExtractedDocVisible) {
			tempTab.isClosed = true;
			clearDecorations();
			tempTab.disposables.forEach(disposable => disposable.dispose());

			// Check if the temporary file still exists before attempting to delete
			if (fs.existsSync(tempTab.tempFileName)) {
				try {
					await unlinkAsync(tempTab.tempFileName);
					console.log(`Temporary file ${tempTab.tempFileName} deleted successfully.`);
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to delete temporary file: ${error}`);
				}
			} else {
				console.log(`Temporary file ${tempTab.tempFileName} does not exist.`);
			}

			activeTempTabs.delete(tempTab.originalUri);
		}
	});

	// Listener for when the original document is closed
	const originalCloseHandler = vscode.window.onDidChangeVisibleTextEditors(async () => {
		const allTabs = vscode.window.tabGroups.all.map(group => group.tabs).flat();

		// Convert the original document URI for comparison
		const originalDocUri = vscode.Uri.file(originalDoc.uri.fsPath);

		// Check if the original document is still open in any of the tabs
		const isOriginalDocVisible = allTabs.some(tab => {
			const tabUri = tab.input instanceof vscode.TabInputText ? tab.input.uri : null;
			return tabUri && tabUri.toString().toLowerCase() === originalDocUri.toString().toLowerCase();
		});

		// If the original document is no longer visible, perform the cleanup
		if (!isOriginalDocVisible) {
			tempTab.isClosed = true;
			clearDecorations();
			tempTab.disposables.forEach(disposable => disposable.dispose());
			vscode.window.showInformationMessage('Original document was closed. Closing the extracted document.');
			await unlinkAsync(tempTab.tempFileName);

			// Close the extracted document
			const extractedEditor = vscode.window.visibleTextEditors.find(
				editor => editor.document.uri.toString() === extractedDoc.uri.toString()
			);
			if (extractedEditor) {
				vscode.window.showTextDocument(extractedEditor.document, { preview: false }).then(() => {
					vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				});
			}

			// Remove the temporary tab from activeTempTabs
			activeTempTabs.delete(tempTab.originalUri);
		}
	});


	// Add all listeners to the tempTab's disposables
	tempTab.disposables.push(originalToExtracted, extractedToOriginal, closeHandler, originalCloseHandler);
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

	// Clear all decorations
	const visibleEditors = vscode.window.visibleTextEditors;
	visibleEditors.forEach(editor => {
		editor.setDecorations(originalDecorationType, []);
	});

	// Dispose decoration types
	originalDecorationType.dispose();
}
