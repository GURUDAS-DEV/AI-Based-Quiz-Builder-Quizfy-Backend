import { presentationModel } from "../../Models/Presentation/PresentationModels.js"
import { questionModel } from "../../Models/Presentation/Question/QuestionModel.js"
import { userModel } from "../../Models/UserModel.js";
import fs from "fs";
import path from "path";
import { v2 as cloudinary } from "cloudinary";



//Creating Presentaion and adding question
//this section contains creation only : 

export async function createPresentation(req, res) {
  let { user, title } = req.body;

  if (!user) return res.status(404).json({ Message: "user is not valid" });

  if (!title) title = "Sample"//just implemented for now

  const userDetail = await userModel.findById(user);

  if (!userDetail) return res.status(400).json({ Message: "User not Found!" });

  try {
    const response = await presentationModel.create({
      user: user,
      title: title,
      owner : userDetail.name || "User",
    })

    return res.status(200).json({ Message: "Presentation Created Successfully!", presentationId: response._id, response });
  } catch (e) {
    // console.log("Error : ", e);
    return res.status(500).json({ Message: "Internal Server Error!" });
  }
}

export const deleteSlide = async (req, res) => {
  const { questionId } = req.body;

  if (!questionId)
    return res.status(404).json({ message: "Question Id not found! " });

  try {
    const question = await questionModel.findByIdAndDelete(questionId);
    if (!question)
      return res.status(404).json({ message: "Slide not Found" });

    return res.status(200).json({ message: "Successfully Deleted!" });
  } catch (e) {
    // console.log("Error when deleting the slide : ", e);
    return res.status(500).json({ message: "unexpected Error Occured!" });
  }
}


//create intial questions : 
export async function addQuestion(req, res) {
  const {
    presentationId,
    designType,
    designTemplate,
    question,
    options = [],
    description
  } = req.body;

  if (!presentationId || !designType || !designTemplate || !question) {
    return res.status(400).json({ Message: "All fields are required!" });
  }

  try {
    const presentation = await presentationModel.findById(presentationId);
    if (!presentation) {
      return res.status(404).json({ Message: "Presentation not found!" });
    }

    const order = await questionModel.countDocuments({ presentation: presentationId }) + 1;

    const newQuestion = await questionModel.create({
      presentation: presentationId,
      designType,
      designTemplate,
      question,
      options: options.length ? options : undefined,
      description : description || "",
      order
    });

    return res.status(200).json({
      Message: "Question added successfully!",
      question: newQuestion,
      id: newQuestion._id
    });

  } catch (e) {
    console.error("Error:", e);
    return res.status(500).json({ Message: "Internal Server Error!" });
  }
}



//this section is for searching question and presentation

//search presentations :
export async function GetPresentation(req, res) {
  const { userId } = req.body;
  const { page = 1, limit = 10 } = req.query;

  if (!userId) {
    return res.status(404).json({ Message: "Please provide user id!" });
  }

  try {
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ Message: "User id is not correct!" });
    }

    const skip = (page - 1) * limit;

    const totalPresentations = await presentationModel.countDocuments({ user: userId });
    const presentations = await presentationModel
      .find({ user: userId })
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 }); // latest first

    if (!presentations || presentations.length === 0) {
      return res.status(404).json({ Message: "Presentation not created yet please create first" });
    }

    return res.status(200).json({
      Message: "Presentation found",
      presentations,
      totalPages: Math.ceil(totalPresentations / limit),
      currentPage: parseInt(page),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ Message: "Internal server Error" });
  }
}




//for searching questions : 
export async function searchQuestion(req, res) {
  const { presentationId } = req.body;

  // console.log("Search Questions : ", presentationId);

  if (!presentationId) return res.status(400).json({ Message: "Provide all Details!" });

  try {
    const presentation = await presentationModel.findById(presentationId);

    if (!presentation) return res.status(404).json({ Message: "Presentation not Found!" });

    const question = await questionModel.find({ presentation: presentationId });

    if (!question) return res.status(404).json({ Message: "Question not found" });

    return res.status(200).json({
      presentation,
      question,
    })
  } catch (e) {
    return res.status(500).json({ Message: "Internal Server Error!", error: e.message });
  }

}


//this section is for updating things : 

export async function updateQuestion(req, res) {
  const { questionId } = req.params;
  const { question } = req.body;

  if (question == undefined || question == null) return res.status(400).json({ Message: "Question Not Provided" });

  try {
    const detail = await questionModel.findById(questionId);

    if (!detail) return res.status(404).json({ Message: "Question not found!" });

    detail.question = question;
    await detail.save();

    return res.status(200).json({ Message: "Successfully updated", question: detail.question });

  } catch (e) {
    // console.log("error : ", e);
    return res.status(500).json({ Message: "Internal Server Error!", error: e.message });
  }
}


export async function updateOptionColor(req, res) {
  const { questionId, optionIndex } = req.params;
  const { color } = req.body;

  if (!color) {
    return res.status(400).json({ Message: "Color is required" });
  }

  try {
    const question = await questionModel.findById(questionId);
    if (!question) {
      return res.status(404).json({ Message: "Question not found" });
    }

    if (!question.options || !question.options[optionIndex]) {
      return res.status(400).json({ Message: "Invalid option index" });
    }

    // Update color
    question.options[optionIndex].color = color;
    await question.save();

    return res.status(200).json({
      Message: "Color updated successfully",
      options: question.options
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ Message: "Internal Server Error" });
  }
}

export async function updateOptionText(req, res) {
  const { questionId } = req.params;
  const { options } = req.body;

  if (!options) return res.status(404).json({ Message: "options not provided" });

  try {
    const question = await questionModel.findById(questionId);
    if (!question) {
      return res.status(404).json({ Message: "Question not found!" });
    }

    // Merge only text into existing options
    question.options = options;
    await question.save();

    return res.status(200).json({
      Message: "Options updated successfully!",
      options: question.options
    });
  } catch (err) {
    console.error("Error updating options:", err);
    return res.status(500).json({ Message: "Internal Server Error" });
  }
}

export const updatePresentationName = async (req, res) => {
  const { presentationId, presentationName } = req.body;

  if (!presentationId || !presentationName) return res.status(404).json({ Message: "Please provide all thing" });

  try {
    const presentation = await presentationModel.findById(presentationId);
    if (!presentation) return res.status(404).json({ Message: "Presentation not found!" });

    presentation.title = presentationName;
    await presentation.save();

    return res.status(200).json({ Message: "Updated Successfully", presentation })
  }
  catch (e) {
    return res.status(500).json({ Message: "Internal Server Error" });
  }
}

export const updateQuestionImage = async (req, res) => {
  const { questionId } = req.body;

  // Validation
  if (!questionId)
    return res.status(400).json({ message: "Question ID not provided!" });

  if (!req.file)
    return res.status(400).json({ message: "No image file received!" });

  try {
    const question = await questionModel.findById(questionId);
    if (!question)
      return res.status(404).json({ message: "Question not found!" });

    // ✅ Cloudinary gives you the hosted image URL at req.file.path
    question.Image = req.file.path;

    await question.save();

    return res.status(200).json({
      message: "Image uploaded successfully!",
      imageUrl: question.Image,
      question,
    });
  } catch (error) {
    console.error("❌ Error while saving image:", error);
    return res.status(500).json({ message: "Unexpected error occurred!" });
  }
};

export const deleteQuestionImage = async (req, res) => {
  const { questionId } = req.body;

  if (!questionId) {
    return res.status(400).json({ message: "Question ID is required!" });
  }

  try {
    const question = await questionModel.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found!" });
    }

    // If no image is associated
    if (!question.Image) {
      return res.status(200).json({ message: "No image to delete!" });
    }

    const imageUrl = question.Image;
    const publicId = imageUrl.split("/").slice(-2).join("/").replace(/\.[^/.]+$/, ""); 

    // ✅ Delete from Cloudinary
    await cloudinary.uploader.destroy(publicId);

    // ✅ Remove image reference from DB
    question.Image = null;
    await question.save();

    return res.status(200).json({ message: "Image deleted successfully!" });
  } catch (error) {
    console.error("❌ Error while deleting image:", error);
    return res.status(500).json({ message: "Error while deleting image!" });
  }
};



//This is for deleting presentation and question related to presentation 

export const deletePresenation = async (req, res) => {
  const { presentationId } = req.body;

  if (!presentationId) return res.status(404).json({ Message: "Please Provide Presenation Id !" });

  try {

    const presentation = await presentationModel.findByIdAndDelete(presentationId);
    if (presentation)
      await questionModel.deleteMany({ presentation: presentationId });

    return res.status(200).json({ Message: "Deleted Successfully!" })


  }
  catch (e) {
    // console.log("error : ", e);
    return res.status(500).json({ Message: "Internal Server Error!", error: e.message });
  }
}



//this is for deleting options ; 
export const deleteOptions = async (req, res) => {
  const { questionId } = req.params;
  const { optionId } = req.body;

  if (!questionId || !optionId)
    return res.status(404).json({ message: "All fields are required !" });

  try {
    const question = await questionModel.findById(questionId);

    if (!question)
      return res.status(404).json({ message: "question not found!" });

    if (question.options.length <= 3)
      return res.status(400).json({ message: "Minimum 3 option you can have!" })

    question.options = question.options.filter((s) => s._id.toString() !== optionId);

    await question.save();


    return res.status(200).json({ Message: "Successfully Deleted!", question });


  } catch (e) {
    console.error("Error deleting option:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
}

//this is for adding options : 
export const addOption = async (req, res) => {
  const { questionId } = req.params;

  if (!questionId)
    return res.status(404).json({ message: "Question Id is not found! " });

  try {
    const question = await questionModel.findById(questionId);

    if (!question)
      return res.status(404).json({ message: "Presentation Not found!" });

    if (question.options.length >= 5)
      return res.status(400).json({ message: "Can't add more than 5 options!" })

    const newOption = {
      text: "new Option",
      color: "#186DDC",
      votes: 0
    }

    question.options.push(newOption);
    await question.save();


    return res.json({ message: "Updated Successfully", question });

  } catch (e) {
    // console.log("error : ", e);
    return res.status(500).json({ Message: "Error", error: e.message });
  }
}

export const addCorrectOption = async (req, res) => {
  const { questionId, optionId } = req.body;

  if (!questionId || !optionId)
    return res.status(404).json({ message: "Please Provide fields! " });

  try {
    const question = await questionModel.findById(questionId);
    if (!question)
      return res.status(404).json({ message: "Question not Found" });

    const option = question.options.id(optionId);

    if (!option)
      return res.status.json({ message: "Option doesn't found! " });

    option.answer = true;

    question.options.forEach(opt => {
      if (opt._id.toString() !== optionId) {
        opt.answer = false;
      }
    });

    await question.save();

    return res.status(200).json({ message: "Correct option set successfully.", question });
  }
  catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Internal server error.", error: e.message });
  }
};

export const changeTemplate = async (req, res) => {
  const { questionId, newDesignTemplate } = req.body;

  if (!questionId || !newDesignTemplate)
    return res.status(404).json({ message: "Please provide neccessary things!" });

  try {
    const question = await questionModel.findById(questionId);

    if (!question)
      return res.status(404).json({ message: "Question not Found!" });

    question.designTemplate = newDesignTemplate;
    await question.save();

    return res.status(200).json({ message: "Update Successfully", question });
  }
  catch (e) {
    // console.log("error in changing template!");
    return res.status(500).json({ message: "Error", error: e.message });
  }
}

export const AddAdmin = async (req, res) => {
  const { userGmail, presentationId } = req.body;

  if (!userGmail || !presentationId) {
    return res.status(400).json({ message: "Please provide both userGmail and presentationId" });
  }

  try {
    // 1. Find the user by email
    const user = await userModel.findOne({ email: userGmail });


    if (!user) {
      return res.status(404).json({ message: "User not found for the Given Email" });
    }

    // 2. Find the presentation by its ID
    const presentation = await presentationModel.findById(presentationId);

    if (!presentation) {
      return res.status(404).json({ message: "Presentation Not found!" });
    }


    // 3. Create the admin object
    const admin = {
      userId: user._id, // Use the user's _id (ObjectId)
      userName: user.name || "User", // If name is missing, fallback to "User"
      userGmail: user.email, // Use the email from the user document
      createdAt: new Date(), // Set the current time as creation time
    };

    if (String(presentation.user) === String(admin.userId)) {
      return res.status(405).json({ message: "User is already the owner of the presentation" });
    }

    const adminExists = presentation.addedAdmin.some(admin => String(admin.userId) === String(user._id));
    if (adminExists) {
      return res.status(405).json({ message: "User is already an admin of this presentation" });
    }

    // 4. Push the admin object into the addedAdmin array
    presentation.addedAdmin.push(admin);

    await presentation.save();


    return res.status(200).json({ message: "Admin Added Successfully", presentation });
  } catch (e) {
    console.error("Error while adding admin:", e);
    return res.status(500).json({ message: "Error while adding admin!" });
  }
};


export const deleteAddedAdmin = async (req, res) => {
  const { presentationId, userId } = req.body;

  if (!presentationId || !userId) {
    return res.status(400).json({ message: "Please provide all the necessary information!" });
  }

  try {
    // Check if the presentation exists
    const presentation = await presentationModel.findById(presentationId);

    if (!presentation) {
      return res.status(404).json({ message: "Presentation not found!" });
    }

    // Filter out the admin from the addedAdmin array
    const initialAdminCount = presentation.addedAdmin.length;
    presentation.addedAdmin = presentation.addedAdmin.filter(
      (admin) => admin.userId.toString() !== userId.toString()
    );

    // If no admin was removed, inform the user
    if (presentation.addedAdmin.length === initialAdminCount) {
      return res.status(404).json({ message: "Admin not found in the presentation!" });
    }

    // Save the updated presentation
    await presentation.save();

    return res.status(200).json({ message: "Admin successfully deleted!", presentation });
  } catch (e) {
    console.error("Error deleting added admin:", e);
    return res.status(500).json({ message: "An error occurred while deleting the admin!" });
  }
};


export const addDescription = async (req, res) => {
  const { questionId, description } = req.body;

  if (!questionId || !description)
    return res.status(404).json({ message: "Please Provide all the things! " });

  try {
    const question = await questionModel.findById(questionId);

    if (!question) {
      return res.status(404).json({ message: "Question not found!" });
    }

    question.description = description;
    await question.save();

    return res.status(200).json({ message: "Description saved successfully!", question });
  }
  catch (e) {
    // console.log("error while saving description!", e);
    return res.status(500).json({ message: "Error while saving description!" });
  }
}


//for sharing presentation : 
export const sharePresentation = async (req, res) => {
  const { userId } = req.body;
  if(!userId)
    return res.status(404).json({message : "User Id not found!"});

  try{
    const user = await userModel.findById(userId);
    if(!user)
      return res.status(404).json({message : "User not found!"});

    const presentations = await presentationModel.find({
      "addedAdmin.userId": userId
    });


    if(!presentations){
      return res.status(404).json({message : "No presentation found!"});
    }

    return res.status(200).json({message : "Presentations found!", presentations});
  }
  catch(e){
    // console.log("error in sharing presentation!", e);
    return res.status(500).json({message : "Error in sharing presentation!"});
  }
}