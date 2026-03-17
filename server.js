require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const User = require("./models/User");
const Cart = require("./models/Cart");
const Order = require("./models/Order");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err));

const PORT = 5000;

/* ================= PRODUCTS ================= */

// GET all products (formatted output)
app.get("/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: 1 });

    let output = "";

    products.forEach((product, index) => {
      output += `Product ${index + 1}\n`;
      output += `ID: ${product._id}\n`;
      output += `Name: ${product.name}\n`;
      output += `Price: ${product.price}\n`;
      output += `Description: ${product.description}\n`;
      output += `Stock: ${product.countInStock}\n`;
      output += `---------------------------\n\n`;
    });

    res.send(output);

  } catch (error) {
    res.status(500).send(error.message);
  }
});

// CREATE product
app.post("/products", async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.json({ message: "Product saved", product: savedProduct });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET product by ID
app.get("/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE product
app.put("/products/:id", async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!updatedProduct)
      return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product updated", product: updatedProduct });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE product
app.delete("/products/:id", async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct)
      return res.status(404).json({ message: "Product not found" });

    res.json({ message: "Product deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ================= USERS ================= */

// REGISTER
app.post("/users/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword
    });

    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// LOGIN
app.post("/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user)
      return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ message: "Login successful", token });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ================= AUTH MIDDLEWARE ================= */

const protect = (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ message: "Token failed" });
    }
  } else {
    return res.status(401).json({ message: "No token provided" });
  }
};

/* ================= CART SYSTEM ================= */

// ADD TO CART
app.post("/cart", protect, async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (!productId || !quantity)
      return res.status(400).json({ message: "ProductId and quantity required" });

    const product = await Product.findById(productId);
    if (!product)
      return res.status(404).json({ message: "Product not found" });

    let cart = await Cart.findOne({ user: req.user.id });

    if (!cart) {
      cart = new Cart({
        user: req.user.id,
        items: [{ product: productId, quantity }]
      });
    } else {
      const itemIndex = cart.items.findIndex(
        item => item.product.toString() === productId
      );

      if (itemIndex > -1) {
        cart.items[itemIndex].quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity });
      }
    }

    await cart.save();
    res.json({ message: "Product added to cart", cart });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// VIEW CART
app.get("/cart", protect, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id })
      .populate("items.product");

    if (!cart || cart.items.length === 0)
      return res.json({ message: "Cart is empty" });

    let totalPrice = 0;

    cart.items.forEach(item => {
      totalPrice += item.product.price * item.quantity;
    });

    res.json({ cart, totalPrice });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ================= ORDER SYSTEM ================= */

// PLACE ORDER
app.post("/orders", protect, async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user.id })
      .populate("items.product");

    if (!cart || cart.items.length === 0)
      return res.status(400).json({ message: "Cart is empty" });

    let totalPrice = 0;

    for (let item of cart.items) {

      if (item.product.countInStock < item.quantity) {
        return res.status(400).json({
          message: `Not enough stock for ${item.product.name}`
        });
      }

      totalPrice += item.product.price * item.quantity;

      item.product.countInStock -= item.quantity;
      await item.product.save();
    }

    const order = new Order({
      user: req.user.id,
      orderItems: cart.items.map(item => ({
        product: item.product._id,
        quantity: item.quantity
      })),
      totalPrice
    });

    await order.save();

    cart.items = [];
    await cart.save();

    res.status(201).json({
      message: "Order placed successfully",
      order
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET MY ORDERS
app.get("/orders", protect, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id })
      .populate("orderItems.product");

    if (orders.length === 0)
      return res.json({ message: "No orders found" });

    res.json(orders);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ================= SERVER ================= */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});