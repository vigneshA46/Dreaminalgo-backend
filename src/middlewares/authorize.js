const authorize = (...allowedRoles) => {

  return (req, res, next) => {

    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.log(req.user)
      return res.status(403).json({ message: 'Forbidden' });
    }

    next();
  };
};
 

export default authorize;