import redis from "../../redis/redisClient.js";
import { presentationModel } from "../../Models/Presentation/PresentationModels.js";
import questionResponses from "../../Models/Presentation/questionResponses.js";
import Session from "../../Models/Presentation/Session.js";
import { questionModel } from "../../Models/Presentation/Question/QuestionModel.js";
import { CommentModel } from "../../Models/Presentation/Comment.js";
import jwt, { decode } from "jsonwebtoken";


export const adminControlledQuizHandler = (io, socket) => {

    //----------------------------------------Admin Events-------------------------------------------//
    //-----------------------------Admin Function starts From here----------------------------------//

    //--------------------------------Connection of Admin------------------------------------------//
    socket.on("joinQuizByAdmin", async ({ presentationId, accessToken }) => {
        try {
            if (!presentationId || !accessToken) {
                socket.emit("error", { message: "presentationId or accessToken are required" });
                return;
            }

            const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);

            if (!decodedToken) {
                return res.status(401).json({ message: "Invalid Token!" });
            }

            const { id } = decodedToken;

            const presentation = await presentationModel.findById(presentationId);
            if (!presentation) {
                socket.emit("error", { message: "Presentation not found!" });
                return;
            }

            const isOwner = presentation.user == id;
            const isAddedAdmin = presentation.addedAdmin.find(user => user.userId == id);


            if (!isOwner && !isAddedAdmin) {
                socket.emit("unauthorized", { message: "You are not the Admin!" });
                return;
            }


            socket.join(presentationId);

            const questions = await questionModel.find({ presentation: presentation._id }).sort({ order: 1 });
            if (!questions.length) {
                socket.emit("error", { message: "Questions not found!" });
                return;
            }

            const sessionKey = `quiz:${presentationId}`;
            const existingCurrentStr = await redis.hget(sessionKey, "currentQuestion");
            const existingQuestionsStateStr = await redis.hget(sessionKey, "questionsState");

            //getting participants from redis when user joins
            const participantKey = `quiz:${presentationId}:participants`;
            const allParticipantsObj = await redis.hgetall(participantKey);


            const responses = await redis.lrange(`responses:${presentationId}`, 0, -1);
            const parsedResponses = responses.map(r => JSON.parse(r));

            // Send all stored responses to the newly connected admin
            socket.emit("existingResponses", parsedResponses);

            if (allParticipantsObj && Object.keys(allParticipantsObj).length > 0) {
                // participants exist in Redis
                const participants = Object.values(allParticipantsObj).map((p) => JSON.parse(p));
                io.of("/adminControlledQuiz").to(presentationId).emit("participantsUpdate", { participants });
            } else {
                // no participants yet
                io.of("/adminControlledQuiz").to(presentationId).emit("participantsUpdate", { participants: [] });
            }


            if (existingCurrentStr) {
                // There is already a currentQuestion stored in Redis (resume case).
                const currentQuestion = JSON.parse(existingCurrentStr);

                // If a full questionsState isn't present yet, build it now from DB questions,
                // preserving votes for the current question (if any).
                if (!existingQuestionsStateStr) {
                    const questionsState = questions.map((q, idx) => {
                        if (idx === currentQuestion.index) {
                            // Use votes/options from currentQuestion if available
                            return {
                                index: idx,
                                _id: q._id,
                                question: q.question,
                                designType: q.designType,
                                Image: q.Image,
                                designTemplate: q.designTemplate,
                                description: q.description,
                                options: q.options.map((o, optIdx) => ({
                                    _id: o._id,
                                    text: o.text,
                                    color: o.color,
                                    answer: o.answer,
                                    votes: (currentQuestion.options && currentQuestion.options[optIdx] && currentQuestion.options[optIdx].votes) || 0,
                                })),
                                votes: currentQuestion.votes || {},
                            };
                        } else {
                            // Fresh question state (no votes yet)
                            return {
                                index: idx,
                                _id: q._id,
                                question: q.question,
                                designType: q.designType,
                                Image: q.Image,
                                description: q.description,
                                designTemplate: q.designTemplate,
                                options: q.options.map(o => ({ _id: o._id, text: o.text, color: o.color, votes: 0, answer: o.answer })),
                                votes: {},
                            };
                        }
                    });

                    await redis.hset(sessionKey, "questionsState", JSON.stringify(questionsState));
                    await redis.hset(sessionKey, "currentIndex", String(currentQuestion.index || 0));
                }

                // Send current question to admin and users (backwards compatible)
                socket.emit("newQuestionForAdmin", { question: currentQuestion });
                io.of("/adminControlledQuiz").in(presentationId).emit("newQuestionForUser", { question: currentQuestion });

            } else {
                // Start a brand new session: initialize questionsState (with votes=0)
                const first = questions[0];
                const currentQuestionObj = {
                    index: 0,
                    _id: first._id,
                    question: first.question,
                    designType: first.designType,
                    Image: first.Image,
                    description: first.description,
                    designTemplate: first.designTemplate,
                    options: first.options.map((o) => ({ _id: o._id, text: o.text, color: o.color, votes: 0, answer: o.answer })),
                    isLive: first.isLive,
                    votes: {}, // map userId -> optionIndex
                };

                // Build full questionsState with votes initialized to 0
                const questionsState = questions.map((q, idx) => ({
                    index: idx,
                    _id: q._id,
                    question: q.question,
                    designType: q.designType,
                    Image: q.Image,
                    description: q.description,
                    designTemplate: q.designTemplate,
                    options: q.options.map(o => ({ _id: o._id, text: o.text, color: o.color, votes: 0, answer: o.answer })),
                    votes: {},
                }));

                await redis.hset(sessionKey, "questions", JSON.stringify(questions)); // raw DB docs (optional reference)
                await redis.hset(sessionKey, "questionsState", JSON.stringify(questionsState));
                await redis.hset(sessionKey, "currentIndex", "0");
                await redis.hset(sessionKey, "currentQuestion", JSON.stringify(currentQuestionObj));

                await Session.create({
                    quizId: presentationId,
                    status: "live",
                    currentQuestionIndex: 0,
                    questions: questions.map((q) => ({
                        questionId: q._id,
                        text: q.question,
                        type: q.designType,
                        options: q.options.map((o) => ({ text: o.text, color: o.color, answer: o.answer })),
                    })),
                    results: [],
                });

                socket.emit("newQuestionForAdmin", { question: currentQuestionObj });
                // don't need to emit to users here — users will get it when they join via joinQuizByUser flow
            }
        } catch (err) {
            console.error("Error starting quiz:", err);
            socket.emit("error", { message: "Failed to start quiz" });
        }
    });


    // ----------------- nextQuestion handler -------------------------------//
    socket.on("nextQuestion", async ({ presentationId, accessToken }) => {
        try {

            if (!presentationId || !accessToken) {
                socket.emit("error", { message: "presentationId or accessToken are required" });
                return;
            }

            const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);

            if (!decodedToken) {
                return res.status(401).json({ message: "Invalid Token!" });
            }

            const { id } = decodedToken;

            const presentation = await presentationModel.findById(presentationId);
            if (!presentation) {
                socket.emit("error", { message: "Presentation not found!" });
                return;
            }

            const isOwner = presentation.user == id;
            const isAddedAdmin = presentation.addedAdmin.find(user => user.userId == id);

            if (!isOwner && !isAddedAdmin) {
                socket.emit("unauthorized", { message: "You are not the Admin!" });
                return;
            }


            const sessionKey = `quiz:${presentationId}`;
            const questionsStateStr = await redis.hget(sessionKey, "questionsState");
            const currentIndexStr = await redis.hget(sessionKey, "currentIndex");

            if (!questionsStateStr || currentIndexStr === null) {
                socket.emit("error", { message: "No active session/questions found for this presentation." });
                return;
            }

            const questionsState = JSON.parse(questionsStateStr);
            const currentIndex = parseInt(currentIndexStr, 10);

            const currentQuestionState = questionsState[currentIndex];
            if (!currentQuestionState) {
                socket.emit("error", { message: "Current question not found in state." });
                return;
            }

            // Save responses to DB (if any) based on the current question's votes map
            const responsesToInsert = Object.entries(currentQuestionState.votes || {}).map(([userId, optionIndex]) => ({
                sessionId: presentationId,
                questionIndex: currentIndex,
                userId,
                optionId: currentQuestionState.options?.[optionIndex]?._id || null,
            }));
            if (responsesToInsert.length) await questionResponses.insertMany(responsesToInsert);

            // Update Session results in Mongo (accumulate)
            const quizSession = await Session.findOne({ quizId: presentationId });
            if (quizSession) {
                if (!quizSession.results[currentIndex]) quizSession.results[currentIndex] = {};
                for (const optionIndex of Object.values(currentQuestionState.votes || {})) {
                    quizSession.results[currentIndex][optionIndex] =
                        (quizSession.results[currentIndex][optionIndex] || 0) + 1;
                }
                await quizSession.save();
            }

            const nextIndex = currentIndex + 1;
            if (nextIndex < questionsState.length) {
                const nextQuestionState = questionsState[nextIndex];

                // Update pointer and currentQuestion in Redis (do NOT reset votes)
                await redis.hset(sessionKey, "currentIndex", String(nextIndex));
                await redis.hset(sessionKey, "currentQuestion", JSON.stringify(nextQuestionState));


                // Emit to admin and all users in the room (use room emit so all users receive)
                socket.emit("newQuestionForAdmin", { question: nextQuestionState });
                io.of("/adminControlledQuiz").in(presentationId).emit("newQuestionForUser", { question: nextQuestionState });

            } else {
                // End quiz
                socket.emit("endQuiz", "Quiz is ended");
                io.of("/adminControlledQuiz").in(presentationId).emit("quizEnded", "Quiz is ended");
                await Session.updateOne({ quizId: presentationId }, { status: "ended", endedAt: new Date() });
                await redis.del(sessionKey);
            }
        } catch (err) {
            console.error("Error moving to next question:", err);
            socket.emit("error", { message: "Failed to move to next question" });
        }
    });


    //------------------------------------3rd Handler----------------------------------//
    //---------------------------------Previous Question-------------------------------//
    socket.on("previousQuestion", async ({ presentationId, accessToken }) => {
        try {

            if (!presentationId || !accessToken) {
                socket.emit("error", { message: "presentationId or accessToken are required" });
                return;
            }

            const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);

            if (!decodedToken) {
                return res.status(401).json({ message: "Invalid Token!" });
            }

            const { id } = decodedToken;

            const presentation = await presentationModel.findById(presentationId);
            if (!presentation) {
                socket.emit("error", { message: "Presentation not found!" });
                return;
            }

            const isOwner = presentation.user == id;
            const isAddedAdmin = presentation.addedAdmin.find(user => user.userId == id);

            if (!isOwner && !isAddedAdmin) {
                socket.emit("unauthorized", { message: "You are not the Admin!" });
                return;
            }

            const sessionKey = `quiz:${presentationId}`;
            const questionsStateStr = await redis.hget(sessionKey, "questionsState");
            const currentIndexStr = await redis.hget(sessionKey, "currentIndex");

            if (!questionsStateStr || currentIndexStr === null) {
                socket.emit("error", { message: "No active session/questions found for this presentation." });
                return;
            }

            const questionsState = JSON.parse(questionsStateStr);
            const currentIndex = parseInt(currentIndexStr, 10);

            if (currentIndex <= 0) {
                socket.emit("error", { message: "Already at the first question, can't go back further." });
                return;
            }

            const prevIndex = currentIndex - 1;
            const prevQuestionState = questionsState[prevIndex];

            if (!prevQuestionState) {
                socket.emit("error", { message: "Previous question not found in state." });
                return;
            }

            // Update pointer + currentQuestion in Redis
            await redis.hset(sessionKey, "currentIndex", String(prevIndex));
            await redis.hset(sessionKey, "currentQuestion", JSON.stringify(prevQuestionState));


            // Send to admin + all users
            socket.emit("newQuestionForAdmin", { question: prevQuestionState });
            io.of("/adminControlledQuiz").in(presentationId).emit("newQuestionForUser", { question: prevQuestionState });

        } catch (err) {
            console.error("Error moving to previous question:", err);
            socket.emit("error", { message: "Failed to move to previous question" });
        }
    });


    //-----------------------------------4th Handler----------------------------------//
    //-----------------------------------Count Votes------------------------------------//
    // -------------------------- submitVote handler -----------------------------------//
    socket.on("submitVote", async ({ presentationId, userId, userName, optionIndex }) => {
        try {
            const sessionKey = `quiz:${presentationId}`;
            const questionsStateStr = await redis.hget(sessionKey, "questionsState");
            const currentIndexStr = await redis.hget(sessionKey, "currentIndex");

            if (!questionsStateStr || currentIndexStr === null) {
                socket.emit("error", { message: "No active session/questions found." });
                return;
            }

            const questionsState = JSON.parse(questionsStateStr);
            const currentIndex = parseInt(currentIndexStr, 10);
            const currentQuestion = questionsState[currentIndex];

            if (!currentQuestion) {
                socket.emit("error", { message: "Current question not found in state." });
                return;
            }

            // Prevent double voting
            currentQuestion.votes = currentQuestion.votes || {};
            if (currentQuestion.votes[userId] !== undefined) {
                socket.emit("alreadyVoted", { message: "You already voted!" });
                return;
            }

            // Save vote
            currentQuestion.votes[userId] = optionIndex;

            // Recalculate option counts
            const updatedCounts = {};
            for (const idx of Object.values(currentQuestion.votes)) {
                updatedCounts[idx] = (updatedCounts[idx] || 0) + 1;
            }

            currentQuestion.options = currentQuestion.options.map((opt, idx) => ({
                ...opt,
                votes: updatedCounts[idx] || 0,
            }));

            // Persist state
            questionsState[currentIndex] = currentQuestion;
            await redis.hset(sessionKey, "questionsState", JSON.stringify(questionsState));
            await redis.hset(sessionKey, "currentQuestion", JSON.stringify(currentQuestion));

            // Build log entry
            const optionLabel = typeof optionIndex === "number" ? String.fromCharCode(65 + optionIndex) : null;
            const optionText = currentQuestion.options[optionIndex]?.text || null;

            const responseEntry = {
                questionIndex: currentQuestion.index,
                userId,
                userName,
                optionIndex,
                optionLabel,
                optionText,
                timestamp: Date.now(),
            };

            // Store response in Redis list for replay
            await redis.rpush(`responses:${presentationId}`, JSON.stringify(responseEntry));

            // Emit to update UI
            io.of("/adminControlledQuiz")
                .in(presentationId)
                .emit("voteUpdate", { question: currentQuestion });

            // Emit userResponse log entry
            io.of("/adminControlledQuiz")
                .in(presentationId)
                .emit("userResponse", {
                    question: currentQuestion,
                    user: { userId, userName },
                    optionIndex,
                    optionLabel,
                    optionText,
                });

        } catch (err) {
            console.error("Error submitting vote:", err);
            socket.emit("error", { message: "Failed to submit vote." });
        }
    });


    //------------------------------------5th Handler----------------------------------//
    //----------------------------------- Commetns ------------------------------------//
    // Comment socket handlers inside adminControlledQuizHandler

    socket.on("sendComment", async ({ presentationId, userId, userName, message }) => {
        try {
            if (!presentationId || !message) {
                socket.emit("error", { message: "Missing presentationId or message" });
                return;
            }

            const comment = {
                presentationId,
                userId,
                userName,
                message,
                timestamp: Date.now(),
            };

            const commentKey = `quiz:${presentationId}:comments`;

            // Push comment to Redis (list)
            await redis.rpush(commentKey, JSON.stringify(comment));

            // Reset TTL every time new comment comes (30 minutes)
            await redis.expire(commentKey, 1800);

            // Broadcast to everyone in room
            io.of("/adminControlledQuiz")
                .to(presentationId)
                .emit("newComment", comment);

        } catch (err) {
            console.error("Error saving comment:", err);
            socket.emit("error", { message: "Failed to send comment" });
        }
    });

    //--------------------------------- 6th Handler ----------------------------------//
    //-------------------------------- get Comments ------------------------------------//
    socket.on("getComments", async ({ presentationId }) => {
        try {
            if (!presentationId) {
                socket.emit("error", { message: "presentationId is required" });
                return;
            }

            const commentsKey = `quiz:${presentationId}:comments`;
            const comments = await redis.lrange(commentsKey, 0, -1);
            const parsedComments = comments.map((c) => JSON.parse(c));

            socket.emit("commentUpdate", { comments: parsedComments });
        } catch (err) {
            console.error("Error fetching comments:", err);
            socket.emit("error", { message: "Failed to get comments" });
        }
    });

    //------------------------------------7th Handler----------------------------------//
    //-------------------------------------End Quiz------------------------------------//
    socket.on("endQuizByAdmin", async ({ presentationId, accessToken }) => {
        if (!presentationId || !accessToken) {
            socket.emit("error", { message: "presentationId or accessToken are required" });
            return;
        }

        const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);

        if (!decodedToken) {
            return res.status(401).json({ message: "Invalid Token!" });
        }

        const { id } = decodedToken;

        const presentation = await presentationModel.findById(presentationId);
        if (!presentation) {
            socket.emit("error", { message: "Presentation not found!" });
            return;
        }

        const isOwner = presentation.user == id;
        const isAddedAdmin = presentation.addedAdmin.find(user => user.userId == id);


        if (!isOwner && !isAddedAdmin) {
            socket.emit("unauthorized", { message: "You are not the Admin!" });
            return;
        }


        try {
            const sessionKey = `quiz:${presentationId}`;

            // 1) Flush responses from Redis
            const responsesArr = await redis.lrange(`responses:${presentationId}`, 0, -1);
            if (responsesArr.length > 0) {
                const parsedResponses = responsesArr.map(r => JSON.parse(r));

                // 2) Insert into QuestionResponse collection
                const responseDocs = parsedResponses.map(r => ({
                    sessionId: presentationId, // still storing quizId here (not _id of Session doc, adjust if needed)
                    questionIndex: r.questionIndex,
                    userId: r.userId || null,
                    optionId: r.optionIndex !== undefined ? r.optionIndex : null,
                    textAnswer: r.textAnswer || null,
                }));
                await questionResponses.insertMany(responseDocs);

                // 3) Update Session aggregated results (use plain object)
                const session = await Session.findOne({ quizId: presentationId });
                if (session) {
                    parsedResponses.forEach(r => {
                        const qKey = String(r.questionIndex); // store as string keys for safety

                        if (!session.results[qKey]) {
                            session.results[qKey] = {}; // initialize question-level object
                        }

                        const optKey = r.optionIndex !== undefined ? String(r.optionIndex) : "text";

                        session.results[qKey][optKey] =
                            (session.results[qKey][optKey] || 0) + 1;
                    });

                    await session.save();
                }
            }

            // 4) End session
            await Session.updateOne(
                { quizId: presentationId },
                { status: "ended", endedAt: new Date() }
            );

            // Clean redis
            await redis.del(sessionKey);
            await redis.del(`responses:${presentationId}`);

            // Move comments
            const commentKey = `quiz:${presentationId}:comments`;
            const commentsArr = await redis.lrange(commentKey, 0, -1);
            if (commentsArr.length > 0) {
                const parsedComments = commentsArr.map(c => JSON.parse(c));
                await CommentModel.insertMany(parsedComments);
            }
            await redis.del(commentKey);

            const participantKey = `quiz:${presentationId}:participants`;
            await redis.del(participantKey);
            // Emit end to clients
            socket.emit("quizEnded", "Quiz is ended");
            io.of("/adminControlledQuiz").in(presentationId).emit("quizEnded", "Quiz is ended");

        } catch (err) {
            console.error("Error ending quiz:", err);
            socket.emit("error", { message: "Failed to end quiz" });
        }
    });



    //------------------------------Admin Function Ends Here----------------------------------//


    //------------------------------------User Events---------------------------------------------//
    //---------------------------User Events Start from Here---------------------------------------//

    //--------------------------------Connection of User------------------------------------------//
    socket.on("joinQuizByUser", async ({ presentationId, userName, userId }) => {
        try {
            if (!presentationId || !userName || !userId) {
                socket.emit("error", { message: "presentationId, userName and userId are required" });
                return;
            }
            socket.presentationId = presentationId; // save for disconnect
            socket.userId = userId;                  // save for disconnect
            socket.join(presentationId);

            socket.join(presentationId)

            const sessionKey = `quiz:${presentationId}`;

            // --- 1) Add participant to Redis ---
            const participantKey = `quiz:${presentationId}:participants`;
            await redis.hset(participantKey, userId, JSON.stringify({ userId, userName }));

            // --- 2) Fetch updated participant list ---
            const allParticipantsObj = await redis.hgetall(participantKey);
            const participants = Object.values(allParticipantsObj).map((p) => JSON.parse(p));

            // --- 3) Emit updated participants to everyone in this quiz ---
            io.of("/adminControlledQuiz").to(presentationId).emit("participantsUpdate", { participants });

            // --- 4) Send current question if exists ---
            const currQuestion = await redis.hget(sessionKey, "currentQuestion");
            if (currQuestion) {
                socket.emit("newQuestionForUser", { question: JSON.parse(currQuestion) });
            } else {
                socket.emit("noCurrentQuestion", { message: "No active question" });
            }
        } catch (error) {
            console.error("🔴 Error in joinQuiz:", error);
            socket.emit("error", { message: "Internal server error" });
        }
    });



    //---------------------------------------User Disconnection------------------------------------------//
    //-------------------------------------------2nd handler------------------------------------//

    socket.on("disconnect", async () => {
        const { presentationId, userId } = socket;
        if (!presentationId || !userId) return;

        const participantKey = `quiz:${presentationId}:participants`;
        await redis.del(participantKey, userId);

        const allParticipantsObj = await redis.hgetall(participantKey);
        const participants = Object.values(allParticipantsObj).map((p) => JSON.parse(p));

        io.of("/adminControlledQuiz").to(presentationId).emit("participantsUpdate", { participants });
    });
}