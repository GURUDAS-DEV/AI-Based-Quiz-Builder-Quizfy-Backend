import { CommentModel } from "../../Models/Presentation/Comment.js";
import { presentationModel } from "../../Models/Presentation/PresentationModels.js";
import { questionModel } from "../../Models/Presentation/Question/QuestionModel.js";
import redis from "../../redis/redisClient.js";
import jwt from "jsonwebtoken";

export const userControlledQuizHandler = async (io, socket) => {
    //--------------------------User Controlled Quiz starts frm here ----------------------//
    //-------------------------1st handler Function-------------------------------//
    //this basically handles the intial connection......

    socket.on("joinQuizByAdmin", async ({ presentationId, accessToken }) => {
        try {
            if (!presentationId || !accessToken) {
                socket.emit("error", { message: "Presentation ID or Access Token is not given!" });
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

            //sending the details for participants to admin : 
            const participantKey = `quiz:${presentationId}:Participants`;
            const allParticipantsObj = await redis.hgetall(participantKey);

            socket.join(presentationId);
            const participants = Object.values(allParticipantsObj).map((s) => JSON.parse(s));

            if (participants && participants.length > 0) {
                io.of("/userControlledQuiz").to(presentationId).emit("participantsList", { participants });
            } else {
                io.of("/userControlledQuiz").to(presentationId).emit("participantsList", { participants: [] });
            }
            // --- Define session keys for User-Controlled Quiz ---
            const sessionKey = `quiz:${presentationId}:userControlled:questions`;
            const metaKey = `quiz:${presentationId}:userControlled:meta`;

            // 1. First check if questions already exist in Redis
            const cachedQuestions = await redis.get(sessionKey);


            if (cachedQuestions) {
                const questionsWithVotes = await buildQuestionsWithVotes(presentationId);
                socket.emit("questionsForAdmin", {
                    questions: questionsWithVotes
                });
                return;
            }

            // 2. Otherwise, fetch from DB
            const questions = await questionModel.find({
                presentation: presentationId,
            }).lean();

            if (!questions || questions.length === 0) {
                socket.emit("error", {
                    message: "No User-Controlled questions found for this Presentation!",
                });
                return;
            }

            // 3. Save into Redis for scalability
            await redis.set(sessionKey, JSON.stringify(questions));

            await redis.set(metaKey, JSON.stringify({
                presentationId,
                type: "userControlled",
                status: "live",
                createdAt: Date.now(),
            }));

            // 4. Emit questions to Admin
            socket.emit("questionsForAdmin", { questions });


        } catch (err) {
            console.error("error in joinQuizByAdmin:", err);
            socket.emit("error", { message: "Error in joining the Quiz!" });
        }
    });


    //------------------------------helper function -----------------------//
    async function buildQuestionsWithVotes(presentationId) {
        const questions = await questionModel.find({ presentation: presentationId }).lean();
        for (const q of questions) {
            for (const opt of q.options) {
                const statsKey = `stats:${presentationId}:${q._id}:${opt._id}`;
                const votes = await redis.get(statsKey);
                opt.votes = votes ? parseInt(votes) : 0;
            }
        }
        return questions;
    }

    //-------------------------------2nd Handler------------------------------//
    //---------------------------------Handles Votes-------------------------//

    socket.on("handleVotes", async ({ presentationId, userId, optionId, userName, questionId }) => {
        if (!presentationId || !userId || !questionId || !optionId) {
            socket.emit("error", { message: "Missing required fields!" });
            return;
        }

        try {
            const metaKey = `quiz:${presentationId}:userControlled:meta`;
            const metaRaw = await redis.get(metaKey);
            if (!metaRaw) {
                socket.emit("error", { message: "Quiz is not live!" });
                return;
            }

            // --- Track attempts per user
            const attemptedKey = `attempts:${presentationId}:${userId}`;
            const attemptedRaw = await redis.get(attemptedKey);
            const attempted = attemptedRaw ? JSON.parse(attemptedRaw) : {};

            attempted[questionId] = { attempted: true, optionId, timeStamp: Date.now() };
            await redis.set(attemptedKey, JSON.stringify(attempted));

            // --- Store individual response
            const responseKey = `response:${presentationId}:${userId}:${questionId}`;
            await redis.set(responseKey, JSON.stringify({
                presentationId,
                userId,
                userName,
                optionId,
                questionId,
                timeStamp: Date.now()
            }));


            // --- Increment stats counter
            const statsKey = `stats:${presentationId}:${questionId}:${optionId}`;
            await redis.incr(statsKey);

            // --- Emit only the updated question entity back to user
            socket.emit("updatedQuestion", {
                questionId,
                attempted: true,
                optionId,
            });

            // --- Emit full questions array with votes to admin
            const updatedQuestions = await buildQuestionsWithVotes(presentationId);
            io.of("/userControlledQuiz").to(presentationId).emit("votesUpdates", {
                questions: updatedQuestions
            });


        } catch (e) {
            console.error("error in handleVotes:", e);
            socket.emit("error", { message: "Error in handling vote: " + e.message });
        }
    });

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

            // Broadcast to everyone in room
            io.of("/userControlledQuiz")
                .to(presentationId)
                .emit("newComment", comment);

        } catch (err) {
            console.error("Error saving comment:", err);
            socket.emit("error", { message: "Failed to send comment" });
        }
    });


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



    socket.on("quizEndingReq", async ({ presentationId }) => {
        if (!presentationId) {
            socket.emit("error", { message: "Presentation Id is not provided!" });
            return;
        }

        try {
            const commentKey = `quiz:${presentationId}:comments`;
            const commentsArr = await redis.lrange(commentKey, 0, -1);


            if (commentsArr.length > 0) {
                const parsedComments = commentsArr.map(c => JSON.parse(c));
                await CommentModel.insertMany(parsedComments);
                await redis.del(commentKey);
            }


            const pattern = `*:${presentationId}:*`;
            let cursor = '0';
            const keysToDelete = [];

            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = nextCursor;
                keysToDelete.push(...keys);
            } while (cursor !== '0');

            if (keysToDelete.length > 0) {
                await redis.del(...keysToDelete);
            }

            io.of("/userControlledQuiz").to(presentationId).emit("quizEnded", {
                message: "The quiz has ended. All progress for this presentation has been reset."
            });

        } catch (err) {
            console.error("Error in quizEndingReq:", err);
            socket.emit("error", { message: "Error ending the quiz: " + err.message });
        }
    });




    //-------------------------------User Handler----------------------------------//
    //-------------------------------1st handler-----------------------------------//
    //handles when user connects intially : 

    socket.on("quizJoinedByUser", async ({ presentationId, userId, userName, accessToken }) => {

        if (!presentationId) {
            socket.emit("error", { message: "presentation Id not Found!" })
            return;
        }

        const decodedToken = jwt.verify(accessToken, process.env.ACCESS_TOKEN_SECRET);

        if(!decodedToken){
            socket.emit("error", { message: "Invalid Token!" });
            return;
        }

        const { id } = decodedToken;

        const presentation = await presentationModel.findById(presentationId);
        if (!presentation) {
            socket.emit("error", { message: "Presentation not found!" });
            return;
        }

        if(presentation.user == id){
            return socket.emit("unauthorized", { message: "You are and Admin! You can't join as a participant." });
        }

        if(presentation.addedAdmin.find(admin => admin.userId == id)){
            return socket.emit("unauthorized", { message: "You are an Admin! You can't join as a participant." });
        }
        //--------------Participants List -----------------------//
        //adding Participant to the current quiz :
        const participantKey = `quiz:${presentationId}:Participants`;
        await redis.hset(participantKey, userId, JSON.stringify({ userName, userId }));

        socket.presentationId = presentationId;
        socket.userId = userId;

        //giving admin the list of participant after a new entry being made : 
        const allParticipantsObj = await redis.hgetall(participantKey);
        const participants = Object.values(allParticipantsObj).map((r) => JSON.parse(r));
 
        io.of("/userControlledQuiz").to(presentationId).emit("participantsUpdate", { participants });


        const sessionKey = `quiz:${presentationId}:userControlled:questions`;
        const rawData = await redis.get(sessionKey);

        socket.join(presentationId);

        if (!rawData) {
            socket.emit("error", { message: "Quiz is not Being Live Yet" });
            return;
        }

        const questions = JSON.parse(rawData);

        //checking the user has attempted any question or not : 
        const attemptedKey = `attempts:${presentationId}:${userId}`;
        const attemptedRaw = await redis.get(attemptedKey);
        const attempted = attemptedRaw ? JSON.parse(attemptedRaw) : {};



        //adding attempted functionality
        const questionList = questions.map(q => ({
            ...q,
            attempted: attempted[q._id] || false
        }));


        socket.emit("questionForUser", { questions: questionList });


    });

    socket.on("disconnect", async () => {
        const { presentationId, userId } = socket;
        if (!presentationId || !userId) return;

        const participantKey = `quiz:${presentationId}:Participants`;
        await redis.hdel(participantKey, userId);

        const allParticipantsObj = await redis.hgetall(participantKey);
        const participants = Object.values(allParticipantsObj).map((p) => JSON.parse(p));

        io.of("/userControlledQuiz").to(presentationId).emit("participantsUpdateLeft", { participants });
    });
} 