import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useAppStore } from '../store/index.js';
import '@xterm/xterm/css/xterm.css';

export function TerminalPanel() {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const terminalOutput = useAppStore((s) => s.terminalOutput);
    const lastWrittenIdx = useRef(0);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            theme: {
                background: '#131820',
                foreground: '#c8d0dc',
                cursor: '#4fc3f7',
            },
            fontFamily: "'Cascadia Code', 'Fira Code', monospace",
            fontSize: 13,
            cursorBlink: true,
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(containerRef.current);
        fit.fit();

        termRef.current = term;
        fitRef.current = fit;

        const ro = new ResizeObserver(() => fit.fit());
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
            lastWrittenIdx.current = 0;
        };
    }, []);

    useEffect(() => {
        const term = termRef.current;
        if (!term) return;

        if (terminalOutput.length < lastWrittenIdx.current) {
            lastWrittenIdx.current = 0;
            term.clear();
        }

        for (let i = lastWrittenIdx.current; i < terminalOutput.length; i++) {
            const entry = terminalOutput[i]!;
            const text = entry.chunk.replace(/\n/g, '\r\n');
            if (entry.stream === 'stderr') {
                term.write(`\x1b[31m${text}\x1b[0m`);
            } else {
                term.write(text);
            }
        }
        lastWrittenIdx.current = terminalOutput.length;
    }, [terminalOutput]);

    return <div ref={containerRef} className="xterm-container" style={{ width: '100%', height: '100%' }} />;
}
