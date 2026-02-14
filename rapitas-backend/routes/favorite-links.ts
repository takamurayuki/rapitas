import { Elysia, t } from "elysia";
import { prisma } from "../config/database";

const favoriteLinkSchema = {
  title: t.String(),
  url: t.String(),
  description: t.Optional(t.String()),
  icon: t.Optional(t.String()),
  color: t.Optional(t.String()),
  category: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  sortOrder: t.Optional(t.Number()),
};

export const favoriteLinksRouter = new Elysia({ prefix: "/favorite-links" })
  // Get all favorite links
  .get("/", async () => {
    try {
      const links = await prisma.favoriteLink.findMany({
        orderBy: [{ visitCount: "desc" }, { createdAt: "desc" }],
      });

      // Parse JSON fields
      return links.map((link: { tags?: string }) => ({
        ...link,
        tags: link.tags ? JSON.parse(link.tags) : [],
      }));
    } catch (error) {
      console.error("Error fetching favorite links:", error);
      throw error;
    }
  })

  // Get favorite links by category
  .get(
    "/category/:category",
    async ({ params }: { params: { category: string } }) => {
      try {
        const links = await prisma.favoriteLink.findMany({
          where: {
            category: params.category,
          },
          orderBy: [{ visitCount: "desc" }, { createdAt: "desc" }],
        });

        return links.map((link: { tags?: string }) => ({
          ...link,
          tags: link.tags ? JSON.parse(link.tags) : [],
        }));
      } catch (error) {
        console.error("Error fetching favorite links by category:", error);
        throw error;
      }
    },
  )

  // Search favorite links
  .get("/search", async ({ query }: { query: { searchTerm: string } }) => {
    const searchTerm = query.searchTerm;

    if (!searchTerm) {
      return [];
    }

    try {
      const links = await prisma.favoriteLink.findMany({
        where: {
          OR: [
            { title: { contains: searchTerm, mode: "insensitive" } },
            { description: { contains: searchTerm, mode: "insensitive" } },
            { url: { contains: searchTerm, mode: "insensitive" } },
            { tags: { contains: searchTerm, mode: "insensitive" } },
          ],
        },
        orderBy: [{ visitCount: "desc" }, { sortOrder: "asc" }],
      });

      return links.map((link: { tags?: string }) => ({
        ...link,
        tags: link.tags ? JSON.parse(link.tags) : [],
      }));
    } catch (error) {
      console.error("Error searching favorite links:", error);
      throw error;
    }
  })

  // Get a single favorite link
  .get("/:id", async ({ params }: { params: { id: string } }) => {
    try {
      const link = await prisma.favoriteLink.findUnique({
        where: { id: parseInt(params.id) },
      });

      if (!link) {
        throw new Error("Favorite link not found");
      }

      return {
        ...link,
        tags: link.tags ? JSON.parse(link.tags) : [],
      };
    } catch (error) {
      console.error("Error fetching favorite link:", error);
      throw error;
    }
  })

  // Create a new favorite link
  .post(
    "/",
    async ({ body }: { body: typeof favoriteLinkSchema }) => {
      try {
        const { tags, ...data } = body as any;

        const link = await prisma.favoriteLink.create({
          data: {
            ...data,
            tags: tags ? JSON.stringify(tags) : "[]",
          },
        });

        return {
          ...link,
          tags: tags || [],
        };
      } catch (error) {
        console.error("Error creating favorite link:", error);
        throw error;
      }
    },
    {
      body: t.Object(favoriteLinkSchema),
    },
  )

  // Update a favorite link
  .patch(
    "/:id",
    async ({
      params,
      body,
    }: {
      params: { id: string };
      body: Partial<typeof favoriteLinkSchema>;
    }) => {
      try {
        const { tags, ...data } = body as any;

        const link = await prisma.favoriteLink.update({
          where: { id: parseInt(params.id) },
          data: {
            ...data,
            tags: tags !== undefined ? JSON.stringify(tags) : undefined,
          },
        });

        return {
          ...link,
          tags: tags !== undefined ? tags : JSON.parse(link.tags || "[]"),
        };
      } catch (error) {
        console.error("Error updating favorite link:", error);
        throw error;
      }
    },
    {
      body: t.Partial(t.Object(favoriteLinkSchema)),
    },
  )

  // Update visit stats
  .post("/:id/visit", async ({ params }: { params: { id: string } }) => {
    try {
      const link = await prisma.favoriteLink.update({
        where: { id: parseInt(params.id) },
        data: {
          lastVisited: new Date(),
          visitCount: { increment: 1 },
        },
      });

      return {
        ...link,
        tags: JSON.parse(link.tags || "[]"),
      };
    } catch (error) {
      console.error("Error updating visit stats:", error);
      throw error;
    }
  })

  // Delete a favorite link
  .delete("/:id", async ({ params }: { params: { id: string } }) => {
    try {
      await prisma.favoriteLink.delete({
        where: { id: parseInt(params.id) },
      });

      return { success: true };
    } catch (error) {
      console.error("Error deleting favorite link:", error);
      throw error;
    }
  })

  // Reorder favorite links
  .post(
    "/reorder",
    async ({
      body,
    }: {
      body: { links: Array<{ id: number; sortOrder: number }> };
    }) => {
      try {
        const { links } = body;

        // Update sort order for each link
        const updates = links.map((link) =>
          prisma.favoriteLink.update({
            where: { id: link.id },
            data: { sortOrder: link.sortOrder },
          }),
        );

        await prisma.$transaction(updates);

        return { success: true };
      } catch (error) {
        console.error("Error reordering favorite links:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        links: t.Array(
          t.Object({
            id: t.Number(),
            sortOrder: t.Number(),
          }),
        ),
      }),
    },
  );
