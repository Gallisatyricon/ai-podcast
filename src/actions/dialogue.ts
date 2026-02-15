'use server';

import { getElevenLabsClient, handleError, streamToBase64 } from '@/app/actions/utils';
import { Err, Ok, Result } from '@/types';

export interface DialogueInput {
  text: string;
  voiceId: string;
}

export interface CreateDialogueRequest {
  inputs: DialogueInput[];
  modelId?: string;
  seed?: number;
}

const CHAR_LIMIT = 2800; // Safe margin under ElevenLabs 3000 char limit

function batchInputs(inputs: DialogueInput[]): DialogueInput[][] {
  const batches: DialogueInput[][] = [];
  let current: DialogueInput[] = [];
  let currentChars = 0;

  for (const input of inputs) {
    const inputChars = input.text.length;

    if (current.length > 0 && currentChars + inputChars > CHAR_LIMIT) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(input);
    currentChars += inputChars;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export async function createDialogue(
  request: CreateDialogueRequest
): Promise<Result<{ audioBase64: string; processingTimeMs: number }>> {
  const startTime = performance.now();
  const clientResult = await getElevenLabsClient();
  if (!clientResult.ok) return Err(clientResult.error);

  try {
    const client = clientResult.value;
    const batches = batchInputs(request.inputs);

    const audioBuffers: Buffer[] = [];

    for (const batch of batches) {
      const dialogueRequest = {
        inputs: batch.map((input) => ({
          text: input.text,
          voiceId: input.voiceId,
        })),
        modelId: request.modelId || 'eleven_v3',
        languageCode: 'fr',
        settings: {
          stability: 0.5,
        },
        ...(request.seed && { seed: request.seed }),
      };

      const stream = await client.textToDialogue.convert(dialogueRequest);
      const base64 = await streamToBase64(stream);
      audioBuffers.push(Buffer.from(base64, 'base64'));
    }

    // Concatenate all audio buffers
    const combined = Buffer.concat(audioBuffers);
    const processingTimeMs = Math.round(performance.now() - startTime);

    return Ok({
      audioBase64: `data:audio/mpeg;base64,${combined.toString('base64')}`,
      processingTimeMs,
    });
  } catch (error) {
    return handleError(error, 'dialogue generation');
  }
}
