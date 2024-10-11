# Change Log

## [v3.0.0]

- Rewriting of the whole code.
- Separate code do not show the saving dialog when it's closed.
- If you save on the extracted code tab, it will save the changes in the original file.
- Added shortcut Ctrl + Alt + Shift + S to separate code. (Configurable through File > Preferences > Keyboard Shortcuts)
- Fix bug that when you delete lines before the extracted code in the original tab it would remove that amount of lines to the selection. 
- Disabled the creation of multiple synchronized tabs on a single file.
- Updated README.md.
- Replaced gifs with videos.

## [v2.0.1]

- Updated README.md.
- Added refactoring showcase gif screenshot.

## [v2.0.0]

- Updated the whole code.
- Added ✂️ emoji to the Separate Code action.
- The new tab is now open beside the original file.
- Bi-directional update.
- Dynamic increase/decrease of the initial selection range.
- Updated README.md.
- No changes are lost when updating code in the original file.
- Added new gif screenshots.

NOTE: Now when the extracted code tab is empty, it will not synchronize with the original. A minimum of one character is required to apply changes.

## [v1.3.2]

- REVERTED CHANGES TO 1.2.0 DUE TO CRITICAL ISSUES. STAY TUNED FOR A NEW UPDATE.

## [v1.3.1]

!!! THIS VERSION HAS CRITICAL ISSUES, DO NOT USE IT.

- Fix common bug that causes text was not being updated on the source file.

## [v1.3.0]

!!! THIS VERSION HAS CRITICAL ISSUES, DO NOT USE IT.

- You can edit the text in the original file while the code is separated without losing changes.
- Original file is now synchronized with the extracted code.
- New tab

## [v1.2.0]

- Added 111ms of debounce.
- Fix text selection deletion when the new tab is closed

## [v1.1.0]

- Rewrote code
- Fix bug that didnt replace the right selection

## [v1.0.0]

- Initial release
