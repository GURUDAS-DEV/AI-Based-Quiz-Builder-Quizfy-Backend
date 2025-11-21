import { userModel } from "../Models/UserModel.js"
import bcrypt from "bcrypt";
import { generateAccessToken, generateRefreshToken } from "./Authentication/token.js";
import jwt from "jsonwebtoken"

export async function HandleSignUp(req, res) {
    const { name, email, password } = req.body;

    //checking all field have data
    if (!name || !email || !password) return res.status(400).json({ Message: "Fill all fields!" });

    //checking email end with valid syntax
    if (!email.toLowerCase().endsWith('@gmail.com')) return res.status(400).json({ Message: "Enter a Valid Email" })

    //check the user role is valid or not : 


    //checking email is already used or not
    const checkEmail = await userModel.findOne({ email });
    if (checkEmail) return res.status(400).json({ Message: "Email Already used" })

    //checking password is greater than 9 or not
    if (password.length < 9) return res.status(400).json({ Message: "Password must be greater than 8 character!" })

    //hashing the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    //finally after all check user is registered and also added try catch to catching error`
    try {
        const val = await userModel.create({
            name,
            email,
            password: hashedPassword,
        });
        return res.status(201).json({ Message: "Registered Successfully" });
    }
    catch (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ Message: "Something went wrong" });
    }
}

export async function handleLogin(req, res) {
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ Message: "Fill all the fields" });//checking if any field is empty.
    if (password.length < 9) return res.status(400).json({ Message: "Password is Invalid!" });//password must be greater than or eqaul to 8 digit.

    //finding email existence : 
    try {
        //removing whitespaces from email :
        const trimmedEmail = email.trim();
        //finding email : 
        const user = await userModel.findOne({ email: trimmedEmail });

        if (!user) return res.status(404).json({ Message: "Email Not Found!" });

        //comparing password : 
        const isTrue = await bcrypt.compare(password, user.password);

        if (!isTrue) return res.status(400).json({ Message: "Invalid Password!" });

        //generating tokens : 
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        //hence user is verified after all the steps now send him the success message and access and refresh token : 

        //setting refresh token as http only cokkie for security purpose :  
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,       // cannot be accessed by JS
            secure: true,         // ✅ required for HTTPS (Render)
            sameSite: "none",     // ✅ allows cross-origin request
            maxAge: 20 * 24 * 60 * 60 * 1000, // 20 days
        });


        return res.status(202).json({
            Message: "Successfully Logged in!",
            "accessToken": accessToken,
        });

    } catch (err) {
        console.error("error : ", err);
        res.status(400).json({ Message: "something went Wrong" });
    }
}

export async function handleReGenerationAccessToken(req, res) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        return res.status(401).json({ Message: "Token not Found" });
    }
    try {
        const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

        const user = await userModel.findById(payload.id);

        if (!user)
            return res.status(404).json({ message: "User not found" });

        const newAccessToken = generateAccessToken({
            _id: user._id,
            name: user.name,
            email: user.email,
        });

        return res.status(200).json({ accessToken: newAccessToken });
    } catch (err) {
        return res.status(403).json({ Message: "Invalid or Expired Refresh Token" });
    }
}

export async function handleLogout(req, res) {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
        return res.status(200).json({ message: "No refresh token found" });
    }

    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // secure in prod
        sameSite: "Lax",
    });

    return res.status(200).json({ message: "Logged out successfully" });
}

export async function handleDeleteUser(req, res) {
    try {
        const email = req.user.email;
        const deleteUser = await userModel.findOneAndDelete({ email });

        if (!deleteUser) return res.status(404).json({ Message: "User Not Found!" });

        return res.status(200).json({ Message: "User Deleted Successfully!" });

    } catch (err) {
        console.error("error : ", err);
        return res.status(500).json({ Message: "Internal Server Error!" });

    }
}

export async function handleUpdateName(req, res) {
    const { name } = req.body;
    const email = req.user?.email;
    const id = req.user?.id;

    if (!name) return res.status(404).json({ Message: "Please Provide A Input!" });

    if (name.length <= 2) return res.status(400).json({ Message: "Enter a name with Atleast 2 Alphabet !" });

    const regex = /[0-9!@#$%^&*(),.?":{}|<>_\-+=~`[\]\\;]/;
    if (regex.test(name)) return res.status(400).json({ Message: "Enter a Valid Name" });

    try {
        const user = await userModel.findOne({ email });
        if (!user) {
            return res.status(404).json({ Message: "User not found." });
        }

        user.name = name;
        await user.save();
        const newAccessToken = jwt.sign({ _id: user._id, name: user.name, email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });

        return res.status(200).json({
            Message: "Name updated successfully!",
            accessToken: newAccessToken
        });
    }
    catch (err) {
        return res.status(500).json({ Message: "Internal Server Error!", error: err });
    }
}

export async function updatePassword(req, res) {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const reqUser = req.user;
    
    if (!reqUser) return res.status(404).json({ Message: "User Not Found!" });

    if (!currentPassword || !newPassword || !confirmPassword) return res.status(400).json({ Message: "Fill all the Fields!" });

    if (newPassword.length < 9) return res.status(400).json({ Message: "New Password must be greater than 8 character!" });

    if (newPassword != confirmPassword) return res.status(400).json({ Message: "New Password and Confirm Password Doesn't Match!" });


    try {

        const user = await userModel.findOne({ _id: reqUser.id });

        const isTrue = await bcrypt.compare(currentPassword, user.password);

        if (!isTrue) return res.status(400).json({ Message: "Current Password is invalid!" });

        const isSame = await bcrypt.compare(newPassword, user.password);

        if (isSame) return res.status(400).json({ Message: "New Password is Same as Current Password!" });

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        user.password = hashedPassword;
        await user.save();

        return res.status(200).json({ Message: "Password Updated Successfully!" });
    }
    catch (e) {
        return res.status(500).json({ Message: "Internal Server Error", error : e });
    }

}
