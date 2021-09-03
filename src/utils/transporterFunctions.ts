import { customAlphabet, nanoid } from 'nanoid';
import { CachedMetadata, Editor, TFile, View, Notice, EditorSelection, SectionCache } from "obsidian";
import { genericFuzzySuggester } from '../ui/genericFuzzySuggester';
import ThePlugin from '../main';
import { suggesterItem } from '../ui/genericFuzzySuggester';
import { createTextChangeRange } from 'typescript';

function getContextObjects() {
    const currentView: View = this.app.workspace.activeLeaf.view;
    const currentFile: TFile = currentView.file;
    const cache: CachedMetadata = this.app.metadataCache.getFileCache(currentFile)
    const editor: Editor = currentView.editor;
    const currentLine = Number(editor.getCursor().line);
    return { currentView, currentFile, cache, editor, currentLine };
}

// put all sections into groupings of sections under there headings.
// ctx is the context object from 
// function groupifySections(ctx): void {
//     let headingIndex = 0;
//     let currentHeadingLevel = 0;
//     let grouping = 0;
//     for (let i = 0; i < ctx.cache.sections.length; i++) {
//         const sec = ctx.cache.sections[i];
//         if (sec.type === "heading") {
//             currentHeadingLevel = Number(ctx.cache.headings[headingIndex].level);
//             // sec.hT = ctx.cache.headings[headingIndex].heading;
//             headingIndex += 1;
//             if (currentHeadingLevel === 1) grouping += 1;
//         }

//         sec.grp = grouping;
//         sec.hL = currentHeadingLevel;
//     }
//     return ctx.cache.sections;
// }

// Select the current line in the editor of activeLeaf
function selectCurrentLine(): void {
    const ctx = getContextObjects();
    ctx.editor.setSelection({ line: ctx.currentLine, ch: 0 }, { line: ctx.currentLine, ch: ctx.editor.getLine(ctx.editor.getCursor().line).length });
}

//get the current block information from the cache
function indentifyCurrentSection(): SectionCache {
    const ctx = getContextObjects();
    return ctx.cache.sections.find(section => section.position.start.line <= ctx.currentLine && section.position.end.line >= ctx.currentLine);
}

// Select the current section in the editor of activeLeaf
function selectCurrentSection(directionUP = true): void {
    const ctx = getContextObjects();
    const currentRange: EditorSelection[] = ctx.editor.listSelections();
    if (currentRange[0].anchor.line === currentRange[0].head.line &&
        (currentRange[0].head.ch !== ctx.editor.getSelection().length) || (currentRange[0].head.ch === 0 && currentRange[0].anchor.ch === 0) &&
        (ctx.editor.getRange({ line: ctx.currentLine, ch: ctx.editor.getLine(ctx.currentLine).length }, { line: ctx.currentLine, ch: 0 }).length !== 0)) {
        // line not selected, so select the current line
        ctx.editor.setSelection({ line: ctx.currentLine, ch: 0 }, { line: ctx.currentLine, ch: ctx.editor.getLine(ctx.currentLine).length });
    } else {
        // test if this is a block, if it is, select it
        const lastLineOfBlock = ctx.cache.sections.find(section => {
            if (ctx.currentLine >= Number(section.position.start.line) && ctx.currentLine <= Number(section.position.end.line)) {
                return section.position.start;
            }
        });

        if (lastLineOfBlock === undefined) { // likely empty line is being triggered, nothing to select. so try to select the nearest block
            let nearestBlock = null;
            for (const value of Object.entries(ctx.cache.sections)) {
                if (directionUP === false && ctx.currentLine < Number(value.position.end.line) && nearestBlock === null) {
                    nearestBlock = value;
                } else if (directionUP === true && ctx.currentLine > Number(value.position.start.line)) {
                    nearestBlock = value;
                }
            }
            if (nearestBlock !== null) {
                ctx.editor.setSelection({ line: nearestBlock.position.start.line, ch: 0 }, { line: nearestBlock.position.end.line, ch: nearestBlock.position.end.col });
                return;
            }
        }

        const curSels = ctx.editor.listSelections();
        if (lastLineOfBlock && lastLineOfBlock.type === "paragraph" && curSels.length === 1 &&
            (curSels[0].anchor.line !== lastLineOfBlock.position.start.line && curSels[0].head.line !== lastLineOfBlock.position.end.line)) {
            // this clause is testing if the line is selected or some aspect of the block. if not a whole block selected, select the block
            ctx.editor.setSelection({ line: lastLineOfBlock.position.start.line, ch: 0 }, { line: lastLineOfBlock.position.end.line, ch: lastLineOfBlock.position.end.col });
        } else {
            // something is selected, so expand the selection
            let firstSelectedLine = 0;
            let lastSelectedLine = 0;
            let currentBlock = null;
            let proceedingBlock = null;
            let nextBlock = null;
            if (currentRange[0].anchor.line < currentRange[0].head.line) {
                firstSelectedLine = currentRange[0].anchor.line;
                lastSelectedLine = currentRange[0].head.line;
            } else {
                firstSelectedLine = currentRange[0].head.line;
                lastSelectedLine = currentRange[0].anchor.line;
            }
            for (let i = 0; i < ctx.cache.sections.length; i++) {
                if (ctx.currentLine >= ctx.cache.sections[i].position.end.line) {
                    currentBlock = ctx.cache.sections[i];
                    try {
                        nextBlock = ctx.cache.sections[i + 1];
                    } catch (e) { console.log(e) }
                }
                if (firstSelectedLine > ctx.cache.sections[i].position.end.line)
                    proceedingBlock = ctx.cache.sections[i];
            }

            if (proceedingBlock && directionUP) {
                ctx.editor.setSelection({ line: proceedingBlock.position.start.line, ch: 0 },
                    { line: currentBlock.position.end.line, ch: ctx.editor.getLine(currentBlock.position.end.line).length });
                ctx.editor.scrollIntoView({ from: proceedingBlock.position.start, to: proceedingBlock.position.start });
            } else if (directionUP) {
                ctx.editor.setSelection({ line: 0, ch: 0 }, { line: lastSelectedLine, ch: ctx.editor.getLine(lastSelectedLine).length });
                ctx.editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: firstSelectedLine, ch: 0 } });
            } else if (nextBlock && directionUP === false) {
                ctx.editor.setSelection({ line: firstSelectedLine, ch: 0 }, { line: nextBlock.position.end.line, ch: ctx.editor.getLine(nextBlock.position.end.line).length });
                ctx.editor.scrollIntoView({ from: nextBlock.position.start, to: nextBlock.position.start });
            }
        }

    }

} //selectCurrentSection

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwz', 6);

// copy the block reference for the current cursor location into the clipboard
// if header, the header reference is copied into clipobard
// if it is a block of text, the last line in the block is assigned a reference ID and this is copied into the clipboard
async function copyBlockRefToClipboard(copyToClipBoard = true): Promise<string> {
    const ctx = getContextObjects();
    const lastLineOfBlock = ctx.cache.sections.find(section => {
        const currentLine = ctx.currentLine;
        if (currentLine >= Number(section.position.start.line) && currentLine <= Number(section.position.end.line)) {
            return section.position.start;
        }
    });
    if (lastLineOfBlock) {
        if (lastLineOfBlock.type === "heading") {
            const headerText: string = ctx.editor.getRange({ line: ctx.currentLine, ch: 0 }, { line: ctx.currentLine, ch: ctx.editor.getLine(ctx.currentLine).length })
            const block = `![[${ctx.currentFile.name + headerText.trim()}]]`.split("\n").join("");
            if(copyToClipBoard)
                navigator.clipboard.writeText(block).then(text => text);
            else    
                return block;
        } else {
            const id = lastLineOfBlock.id ? lastLineOfBlock.id : nanoid();
            const block = `![[${ctx.currentFile.name}#^${id}]]`.split("\n").join("");
            if (!lastLineOfBlock.id)
                ctx.editor.replaceRange(` ^${id}`, { line: Number(lastLineOfBlock.position.end.line), ch: lastLineOfBlock.position.end.col }, { line: Number(lastLineOfBlock.position.end.line), ch: lastLineOfBlock.position.end.col });
            if(copyToClipBoard) 
                navigator.clipboard.writeText(block).then(text => text);
            else
                return block;
        }
    } else
        new Notice("The current cursor location is not a heading or block of text.");
} //copyBlockRefToClipboard

// loops through current selected text and adds block refs to each paragraph
// returns all block refs found in selection
async function addBlockRefsToSelection(): Promise<Array<string>> {
    console.log('addBlockRefsToSelection')
    const ctx = getContextObjects();
    const curSels = ctx.editor.listSelections();
    let blockRefs = [];
    for (const sel of curSels) {
        const startLine = sel.anchor.line > sel.head.line ? sel.head.line : sel.anchor.line;
        const endLine = sel.anchor.line > sel.head.line ? sel.anchor.line : sel.head.line;
        for (let selectedLineInEditor = startLine; selectedLineInEditor <= endLine; selectedLineInEditor++) {
            for (let sectionCounter = 0; sectionCounter < ctx.cache.sections.length; sectionCounter++) {
                const section = ctx.cache.sections[sectionCounter];
                if (selectedLineInEditor >= section.position.start.line && selectedLineInEditor <= section.position.end.line) {
                    if (section.type === "paragraph" && !section.id) {
                        const newId = nanoid();
                        ctx.editor.replaceRange(` ^${newId}`, { line: Number(section.position.end.line), ch: section.position.end.col }, { line: Number(section.position.end.line), ch: section.position.end.col });
                        blockRefs.push("#^" + newId);
                        selectedLineInEditor = section.position.end.line + 1;
                        break;
                    } else if(section.type === "paragraph") {
                        blockRefs.push("#^" + section.id);
                        selectedLineInEditor = section.position.end.line + 1;
                        break;
                    } else if(section.type === "heading") {
                        const heading = ctx.cache.headings.find(h=>h.position.start.line===section.position.start.line);
                        blockRefs.push("#".repeat(heading.level) + heading.heading );
                        selectedLineInEditor = section.position.end.line + 1;
                        break;
                    } 
                }
            }
        } //selectedLineInEditor
    } //curSels
    return blockRefs;
} //addBlockRefsToSelection()

// displays a file selection  suggester,  then the contents of the file, then calls the callback  with:
// Callback function  will receive: Path+FileName, file contents as an array and line choosen
// if returnEndPoint = true, another suggester is shown so user can select endpoint of selection from file
async function displayFileLineSuggester(plugin: ThePlugin, returnEndPoint: boolean, callback): Promise<void> {
    const chooser = new genericFuzzySuggester(plugin);
    chooser.setSuggesterData(await plugin.fs.getAllFiles("/"));
    chooser.setPlaceholder("Select a file")

    await chooser.display(async (i: suggesterItem) => {
        // @ts-ignore
        const targetFileName = i.item.display;
        const curContent = await plugin.app.vault.adapter.read(targetFileName);
        const fileContentsArray: Array<suggesterItem> = [];

        for (const [key, value] of Object.entries(curContent.split('\n')))
            fileContentsArray.push({ display: value, info: key });

        const firstLinechooser = new genericFuzzySuggester(plugin);
        firstLinechooser.setSuggesterData(fileContentsArray);
        firstLinechooser.setPlaceholder("Select the line from file")

        await firstLinechooser.display(async (iFileLocation: suggesterItem, evt: MouseEvent | KeyboardEvent) => {
            if (returnEndPoint) { //if expecting endpoint, show suggester again
                if (Number(iFileLocation.item.info) === fileContentsArray.length - 1) {
                    //only one element in file, or selection is end of file
                    callback(targetFileName, fileContentsArray, Number(iFileLocation.item.info), Number(iFileLocation.item.info), evt);
                } else {
                    const endPointArray = fileContentsArray.slice(Number(iFileLocation.item.info));
                    const lastLineChooser = new genericFuzzySuggester(plugin);
                    lastLineChooser.setSuggesterData(endPointArray);
                    lastLineChooser.setPlaceholder("Select the last line for the selection")
                    await lastLineChooser.display(async (iFileLocationEndPoint: suggesterItem, evt: MouseEvent | KeyboardEvent) => {
                        callback(targetFileName, fileContentsArray, Number(iFileLocation.item.info), Number(iFileLocationEndPoint.item.info), evt);
                    });
                }
            } else
                callback(targetFileName, fileContentsArray, Number(iFileLocation.item.info), evt);
        });
    });
} //displayFileLineSuggester


// Copies or pushes (transfers) the current line or selection to another file
// copySelection = true for copy, false for move
async function copyOrPushLineOrSelectionToNewLocation(plugin: ThePlugin, copySelection: boolean): Promise<void> {
    const ctx = getContextObjects();
    let selectedText = ctx.editor.getSelection();
    if (selectedText === "") selectedText = ctx.editor.getLine(ctx.currentLine); //get text from current line
    await displayFileLineSuggester(plugin, false, (targetFileName, fileContentsArray, lineNumber) => {
        // @ts-ignore
        fileContentsArray.splice(Number(lineNumber) + 1, 0, { display: selectedText, info: "" });
        let newContents = "";
        for (const line of fileContentsArray)
            newContents += line.display + "\n";
        newContents = newContents.substring(0, newContents.length - 1);
        plugin.app.vault.adapter.write(targetFileName, newContents);
        if (copySelection === false) {//this  is  a move, so delete the selection
            const textSelection = ctx.editor.getSelection();
            if (textSelection === "" || ctx.editor.getLine(ctx.currentLine).length === textSelection.length)
                ctx.editor.replaceRange("", { line: ctx.currentLine, ch: 0 }, { line: ctx.currentLine + 1, ch: 0 })
            else
                ctx.editor.replaceSelection(""); //replace whatever is the  selection
        }
    });
} //copyOrPushLineOrSelectionToNewLocation

// Pull (move) a line or lines from another file
async function copyOrPulLineOrSelectionFromAnotherLocation(plugin: ThePlugin, copySelection: boolean): Promise<void> {
    await displayFileLineSuggester(plugin, true, (targetFileName, fileContentsArray, startLine, endLine) => {
        let stringToInsertIntoSelection = "";
        for (const element of fileContentsArray.slice(startLine, endLine + 1))
            stringToInsertIntoSelection += element.display + "\n";
        const ctx = getContextObjects();
        stringToInsertIntoSelection = stringToInsertIntoSelection.substring(0, stringToInsertIntoSelection.length - 1);
        ctx.editor.replaceSelection(stringToInsertIntoSelection);
        if (copySelection === false) {
            //pull selection, which means deleting what was just copied from original file
            fileContentsArray.splice(startLine, (endLine + 1) - startLine);
            let newContents = "";
            for (const line of fileContentsArray)
                newContents += line.display + "\n";
            newContents = newContents.substring(0, newContents.length - 1);
            plugin.app.vault.adapter.write(targetFileName, newContents);
        }
    });
} //copyOrPulLineOrSelectionFromAnotherLocation

//copy a block reference of the current line to another file
async function pushBlockReferenceToAnotherFile(plugin: ThePlugin): Promise<void> {
    await displayFileLineSuggester(plugin, false, async (targetFileName, fileContentsArray, startLine) => {
        const results = await addBlockRefsToSelection();
        let blockRefs = "";
        const fileName = getContextObjects().currentFile.path;
        if(results.length>0) {
            for(let ref of results)
                blockRefs += `![[${fileName}${ref}]]\n`;
            blockRefs = blockRefs.substring(0, blockRefs.length - 1);
            fileContentsArray.splice(Number(startLine) + 1, 0, { display: blockRefs, info: "" });
            let newContents = "";
            for (const line of fileContentsArray)
                newContents += line.display + "\n";
            newContents = newContents.substring(0, newContents.length - 1);
            plugin.app.vault.adapter.write(targetFileName, newContents);
        }
    });
} //pushBlockReferenceToAnotherFile

// pull a block reference from another file and insert into the current location
async function pullBlockReferenceFromAnotherFile(plugin: ThePlugin): Promise<void> {
    console.log('pullBlockReferenceFromAnotherFile')
} //pullBlockReferenceFromAnotherFile

export {
    selectCurrentLine, copyBlockRefToClipboard, selectCurrentSection,
    indentifyCurrentSection,  copyOrPushLineOrSelectionToNewLocation,
    copyOrPulLineOrSelectionFromAnotherLocation, addBlockRefsToSelection,
    pullBlockReferenceFromAnotherFile, pushBlockReferenceToAnotherFile
}
