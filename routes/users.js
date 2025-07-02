const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const Users = require('../models/Users');

// Body parser middleware
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());

// CREATE
router.post('/', async (req, res) => {
    try {
        const users = new Users(req.body);
        await users.save();
        res.status(201).json(users);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// READ
router.get('/', async (req, res) => {
    try {
        const data = await Users.find();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const updated = await Users.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE
router.delete('/:id', async (req, res) => {
    try {
        await Users.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted Successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;