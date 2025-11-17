import express from "express"
import { createPresentation, addQuestion, searchQuestion, GetPresentation, updatePresentationName, deletePresenation, updateOptionColor, updateOptionText, updateQuestion, deleteOptions, addOption, changeTemplate, AddAdmin, deleteAddedAdmin, updateQuestionImage, addDescription, addCorrectOption, deleteQuestionImage, deleteSlide, sharePresentation } from "../Controller/handleRouteController/handleController.js"
import { checkRole } from "../MiddleWare/requiredRole.js"
import { upload } from "../Config/multer.js";
import { accessingPresentation } from "../MiddleWare/AccessingPresentation.js";

const handleRouter = express.Router();

//handles presentation and question tasks :

handleRouter.post("/createPresentation", createPresentation);
handleRouter.post("/addQuestion", addQuestion);
handleRouter.delete("/deleteSlide", deleteSlide);

handleRouter.patch("/questions/:questionId/editQuestion", updateQuestion); //updating questions
handleRouter.patch("/questions/:questionId/options/:optionIndex/color", updateOptionColor); //for updating options color
handleRouter.patch("/questions/:questionId/options", updateOptionText); // for updating options text
handleRouter.post("/question/:questionId/deleteOption", deleteOptions);
handleRouter.post("/question/:questionId/addOption", addOption);
handleRouter.post("/question/description", addDescription);
handleRouter.post("/question/correctOption", addCorrectOption);

handleRouter.post("/uploadImage", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      // Handle Multer error (like invalid file type or size)
      try {
        const parsed = JSON.parse(err.message);
        return res.status(400).json(parsed);
      } catch {
        return res.status(400).json({ message: err.message });
      }
    }

    // ✅ No error → proceed to controller
    updateQuestionImage(req, res);
  });
});

// ✅ Delete image from Cloudinary + remove from DB
handleRouter.delete("/deleteImage", deleteQuestionImage);


handleRouter.patch("/presentation/editTitle", updatePresentationName);

handleRouter.post("/searchQuestion", accessingPresentation, searchQuestion); // for searching question
handleRouter.post("/GetPresentations", GetPresentation);
handleRouter.post("/editDesignTemplate", changeTemplate);

handleRouter.delete("/DeletePresenation", deletePresenation);

handleRouter.post("/AddAdmin", AddAdmin);
handleRouter.post("/DeleteAddedAdmin", deleteAddedAdmin);
handleRouter.post("/getSharedPresentations", sharePresentation);

export { handleRouter }