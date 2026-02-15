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

export async function POST(req: NextRequest) {
  try {
    const { content, title } = await req.json();

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

    const model = openai("gpt-5-mini");

    const result = streamObject({
      model,
      schema: podcastSchema,
      prompt: `Crée une conversation de podcast captivante EN FRANÇAIS entre deux esprits brillants qui explorent ensemble le contenu suivant. Le format s'inspire de La Conversation scientifique d'Étienne Klein, de Radiolab et du style pédagogique de David Louapre (Science Étonnante).

Titre : ${title || "Article"}

Contenu : ${content}

PERSONAS :

Speaker1 — Sophie (L'Architecte des idées) :
- Esprit de synthèse et sens narratif redoutable, inspirée de la pédagogie de David Louapre
- Construit ses explications en couches successives, chaque concept préparant le suivant
- Utilise des analogies fonctionnelles qui "marchent" dans leurs détails, pas juste décoratives
- Accroche toujours par une situation concrète et familière avant de plonger dans l'abstrait
- Admet ses simplifications avec honnêteté : "Je simplifie un peu ici, mais l'idée c'est que..."
- Sait rendre le complexe limpide sans jamais être condescendante
- A le sens du timing narratif : sait quand révéler, quand faire monter la tension

Speaker2 — Marc (Le Philosophe du réel) :
- Esprit d'Étienne Klein : trouve la dimension philosophique et poétique cachée dans chaque fait
- Pose les questions de fond que personne ne pense à poser — celles qui déplacent le regard
- Fait des connexions inattendues entre la science et l'art, l'histoire, l'expérience humaine
- Capable de transformer une donnée technique en vertige existentiel
- Cite avec élégance — une référence philosophique, un paradoxe historique
- Challenge les évidences : "Mais attends, est-ce qu'on n'est pas en train de présupposer que..."
- Apporte la profondeur sans la lourdeur

DYNAMIQUE DU DUO (inspirée de Radiolab) :
- Les deux sont au même niveau intellectuel — pas de rapport expert/candide
- Ils explorent ENSEMBLE en temps réel, avec des moments de découverte authentiques
- L'un ouvre une porte, l'autre s'y engouffre et trouve quelque chose d'inattendu
- Des moments de "Attends... [réalise] — c'est vertigineux ce que tu dis là"
- Ils se challengent mutuellement avec respect et curiosité
- La conversation construit quelque chose — elle ne tourne pas en rond

STRUCTURE NARRATIVE :
- ACCROCHE : Commencer par une situation concrète, vécue, qui ancre le sujet dans le réel
- CONSTRUCTION : Chaque échange ajoute une strate de compréhension
- PARADOXE : Au moins un moment de renversement qui surprend ou défie l'intuition
- OUVERTURE : Finir sur une question ouverte, philosophique — ne jamais fermer le sujet

STYLE :
- Français naturel et élégant, ni familier ni académique
- Humour discret et intelligent, jamais forcé
- Annotations vocales (tags ElevenLabs v3 en anglais, obligatoire) : [thoughtful], [excited], [laughs], [sighs], [pauses], [whispers], [surprised], [hesitates], [curious]
- Utiliser "—" (tiret cadratin) pour les interruptions naturelles et les pensées qui se chevauchent
- Formulations comme : "C'est là que ça devient fascinant...", "Attends, reprenons—", "Il y a quelque chose de presque poétique là-dedans...", "Ce qui me frappe, c'est que derrière cette question technique, il y a une vraie question philosophique"

IMPORTANT : La conversation TOTALE doit rester sous 2500 caractères pour respecter les limites API. Vise 8-12 échanges courts et percutants. Concentre-toi sur l'aspect le plus fascinant ou surprenant du contenu.`,
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
