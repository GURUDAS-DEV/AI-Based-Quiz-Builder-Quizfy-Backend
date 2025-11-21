import jwt from "jsonwebtoken";
import {accessTokenLife, accessTokenSecret, refreshTokenLife, refreshTokenSecret} from "../../Config/jwt.js";


//generates access token :
export const generateAccessToken = (user)=>{
    return jwt.sign({ id : user._id, name : user.name, email : user.email }, accessTokenSecret, {
        expiresIn : accessTokenLife,
    });
};

//generates refresh token : 
export const generateRefreshToken = (user)=>{
    return jwt.sign({ id : user._id, name : user.name, email : user.email }, refreshTokenSecret, {
        expiresIn : refreshTokenLife,
    });
};