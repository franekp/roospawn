const WINDOW_SIZE = 10;

export class PromptExtractor {
    fragmentFrequencies: Map<string, number> = new Map();
 
    insert(prompt: string) {
        // TODO: should we handle not-full-window prefixes and suffixes specially? Probably not.
        for (let i = 0; i <= prompt.length - WINDOW_SIZE; i++) {
            const fragment = prompt.slice(i, i + WINDOW_SIZE);
            this.fragmentFrequencies.set(fragment, (this.fragmentFrequencies.get(fragment) || 0) + 1);
        }
    }

    score(prompt: string): number[] {
        const scores: number[] = [];
        const activeFrequencies: number[] = [];

        for (let i = 0; i < WINDOW_SIZE; i++) {
            activeFrequencies.push(0);
        }

        for (let i = 0; i < prompt.length; i++) {
            if (i <= prompt.length - WINDOW_SIZE) {
                const fragment = prompt.slice(i, i + WINDOW_SIZE);
                const frequency = this.fragmentFrequencies.get(fragment) || 0;
                activeFrequencies[i % WINDOW_SIZE] = frequency;
            } else {
                activeFrequencies[i % WINDOW_SIZE] = 0;
            }

            scores.push(activeFrequencies.reduce((a, b) => Math.max(a, b), 0));
        }

        return scores;
    }

    summary(prompt: string, scores: number[], size: number): string[] {
        let topIndices = scores.map((score, index) => [score, index]).sort((a, b) => {
            if (a[0] === b[0]) {
                return a[1] - b[1];
            }

            return a[0] - b[0];
        }).slice(0, size).map(([score, index]) => index).sort((a, b) => a - b);

        let result: string[] = [];
        let accumulator = "";
        let lastIndex: number | null = null;

        for (const index of topIndices) {
            if (index - 1 === lastIndex) {
                accumulator += prompt[index];
                lastIndex = index;
            } else {
                if (accumulator.length > 0) {
                    result.push(accumulator);
                    accumulator = "";
                }

                accumulator = prompt[index];
                lastIndex = index;
            }
        }

        if (accumulator.length > 0) {
            result.push(accumulator);
        }

        return result;
    }
}
