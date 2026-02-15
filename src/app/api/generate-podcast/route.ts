import { NextRequest, NextResponse } from "next/server";
import { streamObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const podcastSchema = z.object({
  conversation: z
    .array(
      z.object({
        speaker: z.enum(["Speaker1", "Speaker2"]),
        text: z
          .string()
          .describe(
            "Le texte prononcé par ce speaker, en français, incluant des annotations vocales ElevenLabs v3 comme [laughs], [thoughtful], [excited], [sighs], [whispers], [pauses]"
          ),
      })
    )
    .describe(
      "Une conversation de podcast naturelle en français entre deux esprits brillants explorant le contenu"
    ),
});

type PodcastStyle = 'short' | 'medium' | 'long';

const styleInstructions: Record<PodcastStyle, string> = {
  short: `IMPORTANT : La conversation TOTALE doit rester sous 2500 caractères. Vise 8-12 échanges courts et percutants. Concentre-toi sur l'aspect le plus fascinant ou surprenant du contenu. Durée cible : 3-5 minutes.`,
  medium: `IMPORTANT : La conversation fait environ 6000-8000 caractères. Vise 20-30 échanges. Adopte un style très pédagogique : explique chaque concept clairement, utilise des analogies, vérifie la compréhension. Couvre les aspects principaux du contenu de manière accessible. Durée cible : 10-15 minutes.`,
  long: `IMPORTANT : Cette conversation est un podcast approfondi de 30-35 minutes. Vise 60-80 échanges pour environ 20000-25000 caractères. Explore le contenu en profondeur sous tous ses angles. Prends le temps de développer chaque idée, de débattre, de faire des digressions intellectuelles riches. Chaque concept mérite d'être décortiqué, contextualisé historiquement et philosophiquement. N'hésite pas à faire des parallèles avec d'autres domaines, à explorer les implications, les controverses et les questions ouvertes.`,
};

export async function POST(req: NextRequest) {
  try {
    const { content, title, style = 'short' } = await req.json();

    if (!content) {
      return NextResponse.json(
        { error: "Content is required" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured. Add it to your .env.local file." },
        { status: 500 }
      );
    }

    const podcastStyle: PodcastStyle = ['short', 'medium', 'long'].includes(style) ? style : 'short';
    const model = openai("gpt-5-mini");

    const result = streamObject({
      model,
      schema: podcastSchema,
      prompt: `Tu es un scénariste de podcast audio. Tu écris EN FRANÇAIS un dialogue entre deux personnes qui sera lu à voix haute par un synthétiseur vocal. Le texte que tu produis sera DIRECTEMENT converti en audio — il doit donc être parfaitement adapté à l'oral.

Titre : ${title || "Article"}

Contenu source : ${content}

RÈGLES D'ÉCRITURE POUR L'ORAL (OBLIGATOIRE) :
- JAMAIS de chiffres bruts avec décimales dans le texte. Dire "environ trois fois plus" au lieu de "3.02 fois". Dire "presque cinq fois plus" au lieu de "4.84 fois". Arrondir, reformuler en langage courant.
- JAMAIS de parenthèses. Reformuler en incises naturelles : "c'est-à-dire", "autrement dit", "en gros".
- JAMAIS de noms techniques entre parenthèses comme "(SPECTER 2.0, embeddings à 768 dimensions)". Si le nom technique est important, l'intégrer naturellement : "un outil qui s'appelle SPECTER" ou simplement ne pas le mentionner.
- JAMAIS de citations académiques, de noms de revues ou de références bibliographiques. Dire "une grande étude récente" plutôt que "l'étude publiée dans Nature".
- JAMAIS de listes ou d'énumérations longues. Dire "plusieurs facteurs, et le plus frappant c'est..." plutôt que de tout lister.
- Les phrases doivent être courtes, avec un rythme oral naturel. On respire entre les phrases.
- Utiliser des connecteurs oraux : "tu vois", "en fait", "et là c'est là que ça devient intéressant", "figure-toi que".
- Les interventions doivent être courtes — 2 à 4 phrases max par tour de parole. Pas de monologues.

PERSONAS :

Speaker1 — Sophie :
- Pédagogue brillante, elle rend le complexe limpide
- Construit ses explications par couches, du concret vers l'abstrait
- Utilise des analogies du quotidien qui parlent vraiment
- Dit des choses comme : "Imagine que tu es dans une bibliothèque géante...", "En gros, ce qui se passe c'est que..."
- Honnête sur ses simplifications : "Je caricature un peu, mais l'essentiel c'est ça"

Speaker2 — Marc :
- Le penseur, il cherche le sens derrière les faits
- Pose les vraies questions, celles qui changent la perspective
- Fait des ponts entre les domaines — science, philo, histoire, vie quotidienne
- Dit des choses comme : "Mais attends, ce que tu dis là, ça veut dire que...", "Il y a un truc qui me trouble dans cette idée"
- Challenge avec bienveillance et curiosité

DYNAMIQUE :
- Ils sont à égalité — pas de prof et d'élève
- Ils découvrent ensemble, réagissent, rebondissent
- L'un lance une idée, l'autre la pousse plus loin ou la retourne
- Des vrais moments de surprise : "Non mais attends — c'est dingue ce que ça implique"
- La conversation avance, elle ne tourne pas en rond

STRUCTURE :
- Démarrer par un échange léger et accrocheur qui donne envie d'écouter (pas un exposé)
- Construire progressivement la compréhension
- Au moins un moment de renversement ou de surprise
- Finir sur une question ouverte, pas une conclusion fermée

ANNOTATIONS VOCALES (tags ElevenLabs v3, en anglais, obligatoire) :
- Utiliser avec parcimonie : [laughs], [thoughtful], [excited], [sighs], [pauses], [whispers]
- Placer les tags là où l'émotion survient naturellement dans la phrase — en début, au milieu, ou entre deux phrases. Varier les positions. Ne PAS les regrouper tous en fin de réplique.
- Utiliser "—" pour les interruptions naturelles et les hésitations

${styleInstructions[podcastStyle]}`,
    });

    // Create a readable stream to send partial objects to client
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const partialObject of result.partialObjectStream) {
            // Send each partial update as JSON
            const chunk = JSON.stringify({ 
              type: 'partial',
              data: partialObject 
            }) + '\n';
            
            controller.enqueue(new TextEncoder().encode(chunk));
          }

          // Send final complete object
          const finalObject = await result.object;
          const finalChunk = JSON.stringify({ 
            type: 'complete',
            data: finalObject 
          }) + '\n';
          
          controller.enqueue(new TextEncoder().encode(finalChunk));
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown streaming error';
          const errorChunk = JSON.stringify({
            type: 'error',
            error: errorMessage
          }) + '\n';
          
          controller.enqueue(new TextEncoder().encode(errorChunk));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error("Error generating podcast:", error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to generate podcast conversation: ${errorMessage}` },
      { status: 500 }
    );
  }
}
