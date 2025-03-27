import * as vscode from 'vscode';
import { RooSpawn } from "../../roospawn";

export async function initializeRooSpawn(): Promise<{ rooSpawn: RooSpawn, rooCode: any }> {
    const rooSpawnExtension = vscode.extensions.getExtension('roospawn.roospawn');
    const rooSpawn: RooSpawn = await rooSpawnExtension.activate();
    const rooCodeExtension = vscode.extensions.getExtension('rooveterinaryinc.roo-cline');
    const rooCode = await rooCodeExtension.activate();

    await rooSpawn.showRooCodeSidebar();
    while (!rooCode.isReady()) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }

    return { rooSpawn, rooCode };
}
