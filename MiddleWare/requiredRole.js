export function checkRole(requiredRole) {
  return (req, res, next) => {
    if (!req.body) return res.status(401).json({ Message: "Unauthorized" });

    const {role} = req.body
    if (role !== requiredRole) {
      return res.status(403).json({ Message: "Forbidden: You don't have access" });
    }

    next();
  };
}
