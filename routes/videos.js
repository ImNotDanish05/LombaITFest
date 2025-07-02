const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();
const Videos = require('../models/Videos');

// Body parser middleware
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json());

// CREATE
router.post('/', async (req, res) => {
    try {
        const videos = new Videos(req.body);
        await videos.save();
        res.status(201).json(videos);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// READ
router.get('/', async (req, res) => {
    try {
        const data = await Videos.find();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE
router.put('/:id', async (req, res) => {
    try {
        const updated = await Videos.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updated);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// DELETE
router.delete('/:id', async (req, res) => {
    try {
        await Videos.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted Successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;