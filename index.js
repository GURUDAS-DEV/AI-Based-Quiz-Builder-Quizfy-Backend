import express from "express"
import {connection} from "./connect.js"
import { userRouter } from "./Router/userRoute.js";
import cors from "cors"
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import http from "http"
import {handleRouter} from "./Router/handleRoute.js"
import {initSocket} from './Socket/SocketInstance.js'
import { v2 as cloudinary } from "cloudinary"; 


import dotenv from 'dotenv';
import path from "path";
import { otherRouter } from "./Router/otherRoute.js";
import { AIFeatureRouter } from "./Router/AIFeatureRoute.js";
dotenv.config({path: '.env'});


const app = express();

const port = process.env.PORT || 9000;
const allowedOrigin = [
  'http://localhost:5173',  // your dev server
  'http://localhost:3000',  // your build test server
  'https://quizify-jlg9.onrender.com',
  'https://quizifyai.me' // your deployed frontend
];

app.use(cors({
  origin: allowedOrigin,
  credentials: true,
}));
app.use(cookieParser());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

app.use(express.urlencoded({extended : false}));
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const server = http.createServer(app);

initSocket(server);

connection("mongodb+srv://Gurudas_9811:Radhasoami9811@quizfycluster.odpmhss.mongodb.net/Quiz?retryWrites=true&w=majority&appName=QuizfyCluster")
  .then(() => console.log("Connected Successfully!"))
  .catch((err) => console.log("Error: ", err));


app.use("/user/",userRouter);
app.use("/handleQuestions/",handleRouter);
app.use("/AIFeatures/", AIFeatureRouter);
app.use("/other/", otherRouter);

app.get("/ping", (req, res)=>{
      return res.status(200).json("Pong");
});


server.listen(port, () => {
    console.log("Server started on port 9000!");
});