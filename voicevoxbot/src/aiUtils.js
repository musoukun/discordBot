import { join } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import {
	RunnableSequence,
	RunnablePassthrough,
} from "@langchain/core/runnables";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { playAudio } from "./voicevoxUtils.js";
import { completeInteraction } from "./discordUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { googleApiKey } = JSON.parse(
	readFileSync(join(__dirname, "config_hanada.json"), "utf8")
);

const chatHistories = {};

async function generateAIResponse(question, userId) {
	const lengthLimit = 250;
	const systemPromptContent = `あなたは質問者の質問に日本語で簡潔にこたえるアシスタントです。
    \n質問内容は要約して${lengthLimit}文字以内で回答してください。
    \nわからない場合は「わかりません」と回答してください。
    \n${lengthLimit}文字以上の文章が長くなりそうな回答を求められた場合は、簡潔に要約して回答してください。
		\n要約できなければ、長文で回答することが難しいことを伝えてください。自身について質問されたら、目的のみを伝えてください。
    \nメッセージの解答に関しては、会話履歴の内容に忠実に基づいて回答してください。
    \n解答に関して会話履歴の内容以外を解答に含めないでください。
		\n会話履歴:{chat_history} 
		\n現在の時刻(MM月DD日 mm時:ss分で回答してください): {now}
		\n入力内容: {input}`;

	const prompt = ChatPromptTemplate.fromMessages([
		["system", systemPromptContent],
		["placeholder", "{chat_history}"],
		["human", "{input}"],
	]);

	const model = new ChatGoogleGenerativeAI({
		apiKey: googleApiKey,
		modelName: "gemini-pro",
	});

	const chain = RunnableSequence.from([
		RunnablePassthrough.assign({
			chat_history: ({ chat_history }) => chat_history.slice(-10),
		}),
		prompt,
		model,
		new StringOutputParser(),
	]);

	if (!chatHistories[userId]) {
		chatHistories[userId] = [];
		console.log(
			`新しいユーザー ${userId} のチャット履歴を初期化しました。`
		);
	}

	const response = await chain.invoke({
		chat_history: chatHistories[userId],
		input: question,
		now: new Date(),
	});

	chatHistories[userId].push(new HumanMessage(question));
	chatHistories[userId].push(new AIMessage(response));

	console.log(
		`ユーザー ${userId} のチャット履歴を更新しました。現在の履歴数: ${chatHistories[userId].length}`
	);

	return response;
}

export async function handleVVAICommand(interaction) {
	try {
		await interaction.deferReply({ ephemeral: true });

		const question = interaction.options.getString("question");
		const speakerName =
			interaction.options.getString("speaker") || "ずんだもん (ノーマル)";
		const channelId = interaction.options.getString("channelid");

		if (!interaction.guild) {
			await interaction.editReply({
				content: "このコマンドはサーバー内でのみ使用できます。",
				ephemeral: true,
			});
			return;
		}

		// ユーザーのボイスチャンネル状態をチェック
		const voiceChannel = interaction.member.voice.channel;
		if (!voiceChannel && !channelId) {
			await interaction.editReply({
				content:
					"ボイスチャンネルに入室してから、もう一度コマンドを実行してください。",
				ephemeral: true,
			});
			return;
		}

		console.log("AIに質問:", question);

		const responseText = await generateAIResponse(
			question,
			interaction.user.id
		);

		const options = { channelId };

		await playAudio(interaction, responseText, speakerName, options);

		await interaction.editReply({
			content: `質問:${question}\n\n AIの回答: ${responseText}\n\n読み上げを開始しました。選択された話者: ${speakerName}`,
			ephemeral: true,
		});
	} catch (error) {
		console.error("Error in VVAI command execution:", error);
		await interaction
			.editReply({
				content: "AIの回答生成または読み上げ中にエラーが発生しました。",
				ephemeral: true,
			})
			.catch(console.error);
	} finally {
		completeInteraction(interaction.user.id);
	}
}
