import { Router, Request, Response } from "express";
import prisma from "../services/prisma";
import logger from "../utils/logger";

const router = Router();

// GET /api/users/me
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(user);
  } catch (err) {
    logger.error({ err }, "Failed to get user profile");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id as string },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(user);
  } catch (err) {
    logger.error({ err }, "Failed to get user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
