import express from "express";

import { asyncHandler } from "../middlewares/asyncHandler.js";
import { post as postRecipe, get as getRecipe } from "../controllers/recipe/bake.js";

/**
 * Routes for recipe execution.
 *
 * POST /execute
 * Executes a recipe (body: recipe object); returns aggregated terminal results.
 */
const router = express.Router();

router.post("/execute", asyncHandler(postRecipe));

router.get("/recipes/:recipe", asyncHandler(getRecipe));

export default router;
