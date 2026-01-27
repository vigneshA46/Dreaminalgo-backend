import jwt from 'jsonwebtoken';

const authenticate = (req, res, next) => {
  try {
    // 🍪 Read access token from cookies
    const token = req.cookies?.accessToken;

    if (!token) {
      return res.status(401).json({ message: 'Access token missing' });
    }

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    req.user = {
      id: decoded.id,
      role: decoded.role,
      type: decoded.type || 'user'
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export default authenticate;
