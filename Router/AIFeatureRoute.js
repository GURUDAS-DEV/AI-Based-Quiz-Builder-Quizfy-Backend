import express from "express";
import { sendMessageForAIPoweredQuiz, sendMessageToAI, addQuestionGeneratedByAI, startAIPoweredQuizSession, recordTheAnswerForAIPoweredQuiz } from "../Controller/AI Features/AIFeatureRouter.js";


export const AIFeatureRouter = express.Router();


AIFeatureRouter.post("/sendMessageToAI", sendMessageToAI);
AIFeatureRouter.post("/sendMessageForAIPoweredQuiz", sendMessageForAIPoweredQuiz);
AIFeatureRouter.post("/AddQuestionGeneratedByAI", addQuestionGeneratedByAI);
AIFeatureRouter.get("/GetQuestionsForAIPoweredQuiz/:presentationId/:userId", startAIPoweredQuizSession);

AIFeatureRouter.post("/SubmitAnswerForAIPoweredQuiz",recordTheAnswerForAIPoweredQuiz);
