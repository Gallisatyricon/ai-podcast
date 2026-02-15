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
            "Le texte prononcé par ce speaker, en français. Inclure des audio tags ElevenLabs v3 AVANT le segment qu'ils modifient : tags directionnels [curious], [impressed], [reassuring], [sympathetic], [excited], [thoughtful], [annoyed] et tags non-verbaux [laughs], [sighs], [whispers], [chuckles], [exhales]. Utiliser des MAJUSCULES pour l'emphase et ... pour les pauses. Utiliser — pour les interruptions."
          ),
      })
    )
    .describe(
      "Une conversation de podcast naturelle et dynamique en français, avec interruptions, chevauchements et réactions spontanées"
    ),
});

type PodcastStyle = 'short' | 'medium' | 'long';

const styleInstructions: Record<PodcastStyle, string> = {
  short: `IMPORTANT — FORMAT COURT :
- La conversation TOTALE fait environ 4000-5000 caractères (audio accéléré à 1.3x). Vise 14-20 échanges.
- Concentre-toi sur l'aspect le plus fascinant ou surprenant du contenu.
- Introduis brièvement la source dans les 2-3 premiers échanges (de quoi on parle, d'où ça vient), puis plonge dans le vif.
- Durée cible : 3-5 minutes.`,
  medium: `IMPORTANT — FORMAT MOYEN :
- La conversation fait environ 8000-12000 caractères (audio accéléré à 1.3x). Vise 25-35 échanges.
- Adopte un style très pédagogique : explique chaque concept clairement, utilise des analogies, vérifie la compréhension.
- Introduis la source naturellement dans les premiers échanges (titre, contexte, pourquoi c'est intéressant).
- Couvre les aspects principaux du contenu de manière accessible. Durée cible : 10-15 minutes.`,
  long: `IMPORTANT — FORMAT LONG :
- Cette conversation est un podcast approfondi de 30-35 minutes. Vise 60-80 échanges pour environ 26000-32000 caractères (audio accéléré à 1.3x).
- Introduis la source en posant le cadre dans les premiers échanges.
- Explore le contenu en profondeur sous tous ses angles. Prends le temps de développer chaque idée, de débattre, de faire des digressions intellectuelles riches. Chaque concept mérite d'être décortiqué, contextualisé historiquement et philosophiquement. N'hésite pas à faire des parallèles avec d'autres domaines, à explorer les implications, les controverses et les questions ouvertes.`,
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
      prompt: `Tu es un scénariste de podcast audio. Tu écris EN FRANÇAIS un dialogue entre deux personnes qui sera DIRECTEMENT converti en audio par le synthétiseur vocal ElevenLabs v3. Chaque mot que tu écris sera prononcé — le texte doit être parfaitement adapté à l'oral.

Titre : ${title || "Article"}

Contenu source : ${content}

═══════════════════════════════════════
RÈGLES D'ÉCRITURE POUR L'ORAL
═══════════════════════════════════════

- JAMAIS de chiffres bruts avec décimales. Dire "environ trois fois plus" au lieu de "3.02 fois". Arrondir, reformuler en langage courant.
- JAMAIS de parenthèses. Reformuler en incises naturelles : "c'est-à-dire", "autrement dit", "en gros".
- JAMAIS de noms techniques entre parenthèses. Si le nom technique est important, l'intégrer naturellement : "un outil qui s'appelle SPECTER" ou simplement ne pas le mentionner.
- JAMAIS de citations académiques, de noms de revues ou de références bibliographiques. Dire "une grande étude récente" plutôt que "l'étude publiée dans Nature".
- JAMAIS de listes ou d'énumérations longues. Dire "plusieurs facteurs, et le plus frappant c'est..." plutôt que de tout lister.
- Phrases courtes, rythme oral naturel. On respire entre les phrases.
- Connecteurs oraux : "tu vois", "en fait", "et là c'est là que ça devient intéressant", "figure-toi que".
- Interventions courtes — 2 à 4 phrases max par tour de parole. Pas de monologues.

═══════════════════════════════════════
AUDIO TAGS ELEVENLABS V3 — MODE D'EMPLOI
═══════════════════════════════════════

Le synthétiseur ElevenLabs v3 interprète des audio tags entre crochets. Ces tags contrôlent l'émotion et la livraison vocale. Tu DOIS les utiliser correctement.

RÈGLE D'OR : Le tag se place TOUJOURS AVANT le segment qu'il modifie.
  ✅ "[excited] C'est INCROYABLE ce qu'ils ont trouvé !"
  ❌ "C'est incroyable ce qu'ils ont trouvé ! [excited]"

TAGS DIRECTIONNELS (contrôlent le ton émotionnel) :
  [curious], [impressed], [excited], [thoughtful], [reassuring], [sympathetic], [annoyed], [surprised], [happy], [sad]

TAGS NON-VERBAUX (sons vocaux) :
  [laughs], [chuckles], [sighs], [exhales], [whispers], [clears throat]

RÈGLES D'UTILISATION :
1. Maximum 1 tag par réplique en moyenne. Certaines répliques n'en ont aucun — c'est normal et souhaité.
2. Ne JAMAIS mettre 2 tags dans la même réplique sauf exception naturelle (ex: un [sighs] suivi d'une phrase [thoughtful]).
3. Ne JAMAIS regrouper les tags en fin de réplique.
4. Varier les tags — ne pas répéter le même tag plus de 2 fois dans toute la conversation.
5. Pas de tag sur chaque réplique. Au moins 40% des répliques doivent être SANS aucun tag — laisser le texte et la ponctuation porter l'émotion.

EMPHASE ET RYTHME (alternatives aux tags) :
- MAJUSCULES sur un mot pour l'emphase : "C'est VRAIMENT fascinant"
- Trois points ... pour marquer une pause, une hésitation, un poids : "Et là... tout a basculé"
- Le tiret em — pour les coupures et interruptions : "Mais attends — tu es en train de dire que—"
- Points d'exclamation et d'interrogation pour le rythme naturel

═══════════════════════════════════════
INTERRUPTIONS ET CHEVAUCHEMENTS
═══════════════════════════════════════

Les speakers peuvent se couper la parole ! C'est ce qui rend le dialogue VIVANT.

Techniques :
- Un speaker coupe l'autre avec — en fin de phrase coupée :
  Speaker1: "Et donc si on pousse le raisonnement jusqu'au bout, ça veut dire que—"
  Speaker2: "[excited] Que TOUT ce qu'on croyait savoir est faux !"

- Un speaker rebondit immédiatement sur un mot :
  Speaker1: "C'est un peu comme un effet domino—"
  Speaker2: "Un domino, oui ! Mais un domino à l'échelle planétaire !"

- Un speaker réagit avec un son puis enchaîne :
  Speaker1: "Le résultat, c'est que les deux tiers des modèles se trompent."
  Speaker2: "[laughs] Deux tiers ! Non mais tu te rends compte..."

Vise 2-4 interruptions naturelles dans la conversation. Pas plus — ça doit rester fluide.

═══════════════════════════════════════
PERSONAS
═══════════════════════════════════════

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
- Dit des choses comme : "Mais attends, ce que tu dis là, ça veut dire que—", "Il y a un truc qui me trouble dans cette idée"
- Challenge avec bienveillance et curiosité

═══════════════════════════════════════
DYNAMIQUE DE CONVERSATION
═══════════════════════════════════════

- Ils sont à ÉGALITÉ — pas de prof et d'élève
- Ils découvrent ensemble, réagissent, rebondissent, se coupent parfois la parole
- L'un lance une idée, l'autre la pousse plus loin ou la retourne
- Des vrais moments de surprise : "Non mais attends — c'est DINGUE ce que ça implique"
- La conversation avance, elle ne tourne pas en rond
- Les réactions sont physiques et spontanées : rires, soupirs, exclamations

═══════════════════════════════════════
STRUCTURE
═══════════════════════════════════════

1. OUVERTURE — Poser le cadre naturellement :
   - Introduire le sujet du podcast, en mentionnant d'où vient le contenu (un article, une étude, un sujet qui circule...) de façon conversationnelle, pas scolaire.
   - Ex: "Figure-toi que je suis tombée sur un truc FASCINANT..." ou "Tu as vu ce qui est sorti sur... ?"
   - Le titre ou la source doivent apparaître naturellement dans les 2-3 premiers échanges.

2. DÉVELOPPEMENT — Construire progressivement la compréhension
   - Alterner explications et réactions
   - Au moins un moment de renversement ou de surprise

3. CONCLUSION — Finir sur une question ouverte, pas une conclusion fermée

═══════════════════════════════════════

EXEMPLE DE DIALOGUE BIEN RÉALISÉ (pour référence de style) :

Speaker1: "Figure-toi que je suis tombée sur un article complètement dingue ce matin..."
Speaker2: "[curious] Ah oui ? Sur quoi ?"
Speaker1: "Sur la façon dont notre cerveau traite les fausses informations. Et le résultat est... contre-intuitif."
Speaker2: "Contre-intuitif comment ?"
Speaker1: "[thoughtful] En gros... plus tu essaies de corriger une fake news, plus les gens s'y accrochent."
Speaker2: "Attends — tu es en train de dire que—"
Speaker1: "Que vérifier les faits peut être CONTRE-PRODUCTIF, oui !"
Speaker2: "[laughs] C'est le monde à l'envers ! Mais pourquoi ?"
Speaker1: "Parce que corriger, ça force le cerveau à ré-activer l'information fausse. Et chaque activation... la renforce."
Speaker2: "[sighs] Donc en gros, le simple fait d'en parler..."
Speaker1: "Exactement. C'est un piège cognitif."

═══════════════════════════════════════

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
