import { describe, expect, it } from 'vitest';
import { GeminiAdapter } from "../src/adapter.js";
import { GEMINI_MODEL_DEFINITIONS } from "../src/catalog.js";
describe('GeminiAdapter catalog and metadata', () => {
    const adapter = new GeminiAdapter();
    it('provides correct provider info', () => {
        const info = adapter.providerInfo('gemini');
        expect(info.id).toBe('gemini');
        expect(info.name).toBe('Google Gemini');
    });
    it('lists advertised Gemini models', async () => {
        const models = await adapter.listModels('gemini');
        expect(models.length).toBe(GEMINI_MODEL_DEFINITIONS.length);
        const pro = models.find(m => m.id === 'gemini-2.5-pro');
        expect(pro).toBeDefined();
        expect(pro?.name).toBe('Gemini 2.5 Pro');
        expect(pro?.provider).toBe('gemini');
    });
    it('resolves model info properly with reasoning efforts', async () => {
        const info = await adapter.resolveModel('gemini', 'gemini-2.5-pro');
        expect(info.id).toBe('gemini-2.5-pro');
        expect(info.provider).toBe('gemini');
        expect(info.reasoning?.efforts.map(e => e.id)).toEqual(['low', 'medium', 'high']);
        const flash = await adapter.resolveModel('gemini', 'gemini-2.5-flash');
        expect(flash.id).toBe('gemini-2.5-flash');
        expect(flash.reasoning?.defaultEffort).toBe('low');
    });
    it('throws UNAUTHORIZED when no API key is present in environment', async () => {
        const originalGemini = process.env.GEMINI_API_KEY;
        const originalGoogle = process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        try {
            const call = await adapter.prepareCall('gemini', 'gemini-2.5-pro');
            const stream = call.stream({
                provider: 'gemini',
                model: 'gemini-2.5-pro',
                messages: [{
                        id: 'msg-1',
                        role: 'user',
                        source: { kind: 'user' },
                        content: [{ type: 'text', text: 'hello' }],
                    }],
            });
            const iter = stream[Symbol.asyncIterator]();
            await expect(iter.next()).rejects.toThrow(/Gemini API key is not configured/);
        }
        finally {
            if (originalGemini)
                process.env.GEMINI_API_KEY = originalGemini;
            if (originalGoogle)
                process.env.GOOGLE_API_KEY = originalGoogle;
        }
    });
});
//# sourceMappingURL=adapter.spec.js.map