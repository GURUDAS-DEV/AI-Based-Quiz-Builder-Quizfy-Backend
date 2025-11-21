import reportBugModel from "../../Models/other/reportBug.js";
import reviewModel from "../../Models/other/review.js";


export const reportBug = async (req, res) => {
    const { details, userId, userName } = req.body;

    if (!details || !userId || !userName)
        return res.status(404).json({ message: "Provide all things!" });

    try{
        const newReport = new reportBugModel({ details, userId, userName });
        await newReport.save();
        return res.status(200).json({ message: "Bug submitted successfully!" });
    } 
    catch (error) {
        return res.status(500).json({ message: "Internal server error", error });
    }
}

export const reviewHandler = async(req, res)=>{
    const {userId, userName, rating, comment} = req.body;

    if(!userId || !userName || !rating || !comment)
        return res.status(404).json({message : "Provide all things!"});

    try{
        const newReview = new reviewModel({ userId, userName, rating, comment });
        await newReview.save();
        return res.status(200).json({ message: "Thanks for reviewing us!" });
    }
    catch (error) {
        return res.status(500).json({ message: "Internal server error", error });
    }
}
